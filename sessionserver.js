/*
Copyright (c) 2012-2013 Mattias Erlo. All rights reserved.
Licensed under the 2-clause BSD license.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met: 

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer. 
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution. 

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

var VERSION = "0.5";
var IO_LOG_LEVEL = 1;

// Configurable
var PORTNUMBER_NONSECURE = 8004;
var PORTNUMBER_SECURE = 8005;

// Configurable. Set to -1 to make it limitless.
var MAX_TOTAL_NUMBER_OF_CLIENTS = 1000;
var MAX_NUMBER_OF_SESSIONS = 1000;
var MAX_NUMBER_OF_CLIENTS_PER_SESSION = 1000;

// Configurable
var REUSE_ID_THRESHOLD = 100;

// Configurable
var SSLCERT_PATH = '/sslcert';


var fs = require('fs');
var static = require('node-static');
var file = new(static.Server)('/var/www');

var options = {
	key: fs.readFileSync(SSLCERT_PATH + '/key.pem'),
	cert: fs.readFileSync(SSLCERT_PATH + '/cert.pem')
};

var httpServer = require('http').createServer();
var httpsServer = require('https').createServer(options); 

var io = require('socket.io').listen(httpServer, { });
var ioSecure = require('socket.io').listen(httpsServer, { });

httpServer.listen(PORTNUMBER_NONSECURE);
httpsServer.listen(PORTNUMBER_SECURE);

io.set('log level', IO_LOG_LEVEL);
ioSecure.set('log level', IO_LOG_LEVEL);

console.log("Sessionserver starting up...");
console.log("Version: " + VERSION);
console.log("PORTNUMBER_NONSECURE: " + PORTNUMBER_NONSECURE);
console.log("PORTNUMBER_SECURE: " + PORTNUMBER_SECURE);
console.log("MAX_TOTAL_NUMBER_OF_CLIENTS: " + MAX_TOTAL_NUMBER_OF_CLIENTS);
console.log("MAX_NUMBER_OF_SESSIONS: " + MAX_NUMBER_OF_SESSIONS);
console.log("MAX_NUMBER_OF_CLIENTS_PER_SESSION: " + MAX_NUMBER_OF_CLIENTS_PER_SESSION);

function FifoElement(number) {
	this.number = number;
	this.nextElement = null;
}

function FifoQueue() {
	this.firstElement = null;
	this.lastElement = null;
	this.numElements = 0;
}

FifoQueue.prototype.pushLast = function(number) {
	var newElement = new FifoElement(number);
	if (this.lastElement) {
		this.lastElement.nextElement = newElement;
	}
	this.lastElement = newElement;
	if (this.firstElement == null) {
		this.firstElement = newElement;
	}
	this.numElements++;
};

FifoQueue.prototype.popFirst = function() {
	var number = -1;
	if (this.firstElement) {
		number = this.firstElement.number;
		this.firstElement = this.firstElement.nextElement;
		this.numElements--;
	}
	return number;
};

var clientFifoQueue = new FifoQueue();
var sessionFifoQueue = new FifoQueue();

var pickingClientsFromFifoQueue = false;
var pickingSessionsFromFifoQueue = false;

var currentClientId = 0;
var currentSessionId = 0;

var clientList = new Array();
var sessionList = new Array();

function Client(socket, clientId) {
	this.socket = socket;
	this.clientId = clientId;
	this.clientName = "Client"+currentClientId;
	this.programName = "";
	this.sessionId = -1;
}

function Session(	sessionId, hostClientId,
					programName, sessionName, 
					maxNumberOfClients, sessionOpen,
					sessionNeedsHostToLive, sessionNeedsClientsToLive,
					sessionTimeoutMinutes,
					key, isHiddenSession) {
	this.sessionId = sessionId;
	this.hostClientId = hostClientId;
	this.programName = programName;
	this.sessionName = sessionName;
	this.numberOfClients = 1;
	this.maxNumberOfClients = maxNumberOfClients;
	this.sessionOpen = sessionOpen;
	this.sessionNeedsHostToLive = sessionNeedsHostToLive;
	this.sessionNeedsClientsToLive = sessionNeedsClientsToLive;
	this.sessionTimeoutMinutes = sessionTimeoutMinutes;
	this.key = key;
	this.isHiddenSession = isHiddenSession;

	var tempClient = getClientByClientId(hostClientId);
	this.clientList = new Array();
	this.clientList[0] = tempClient;
	this.timer = null;
	this.cache = new Array();
	this.map = new Object();
}

// Client look-up functions

function getClientBySocket (socket) {
	for (var i=0; i<clientList.length; i++) {
		if (clientList[i].socket == socket) {
			return clientList[i];
		}
	}
	return null;
}

function getClientIdBySocket (socket) {
	var i;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].socket == socket) {
			return clientList[i].clientId;
		}
	}
	return -1;
}

function getClientNameByClientId (clientId) {
	var i;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].clientId == clientId) {
			return clientList[i].clientName;
		}
	}
	return null;
}

function getClientIndexBySocket (socket) {
	var i;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].socket == socket) {
			return i;
		}
	}
	return -1;
}

function getClientByClientId (clientId) {
	var i;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].clientId == clientId) {
			return clientList[i];
		}
    }
	return null;
}

// Session look-up functions

function getSessionIdBySocket (socket) {
	var i;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].socket == socket) {
			return clientList[i].sessionId;
		}
	}
	return -1;
}

function getSessionIndexBySocket (socket) {
	var i, j, sessionId;
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].socket == socket) {
			sessionId = clientList[i].sessionId;
			for (j=0; j<sessionList.length; j++) {
				if (sessionList[j].sessionId == sessionId) {
					return j;
				}
			}			
		}
	}
	return -1;
}

function getSessionBySessionId (sessionId) {
	var i;
	for (i=0; i<sessionList.length; i++) {
		if (sessionList[i].sessionId == sessionId) {
			return sessionList[i];
		}
	}
	return null;
}

// Removal functions

function sessionOpenTimeout (sessionId) {
	console.log("Session open timeout for session " + sessionId);
	console.log("Closing the session now");
	closeSession(sessionId);
}

function removeClientFromSession (clientId) {
	var client = getClientByClientId(clientId);
	if (client) {
		var sessionId = client.sessionId;
		if (sessionId != -1) {
			var i, j;
			var clientName = client.clientName;
			var session = getSessionBySessionId(sessionId);
			if (session) {
				// Remove the client from his session's clientList,
				for (i=0; i<session.clientList.length; i++) {    
					if (session.clientList[i].clientId == clientId) {
						for (j=i; j<session.clientList.length-1; j++) {
							session.clientList[j] = session.clientList[j+1];
						}
						session.clientList.length--;
						break;
					}
				}
				// and inform other clients in the same session that he left
				for (i=0; i<session.clientList.length; i++) {    
					session.clientList[i].socket.emit('clientLeft', {	id: clientId,
																		name: clientName });
				}
				// Check if we should close the session
				if (session.clientList.length == 0 ||
						(session.sessionNeedsHostToLive && session.hostClientId == clientId)) {
					if (session.sessionNeedsClientsToLive) {
						closeSession(sessionId);
					} else {
						// This session does not need any clients to live.
						// Keep the session open for a limited time.
						// If any client reconnects to this session, reset the timeout.
						if (session.timer) {
							clearTimeout(session.timer);
						}
						session.timer = setTimeout(sessionOpenTimeout,
							Math.floor(session.sessionTimeoutMinutes*60*1000), sessionId);
					}
				}
			}
		}
	}
}

function removeClientId (clientId) {
	var i, j;
	var sessionId = -1;
	var clientName;

	console.log("Remove client id " + clientId);

	removeClientFromSession(clientId); 

	// Remove the client from the clientList
	for (i=0; i<clientList.length; i++) {
		if (clientList[i].clientId == clientId) {
			for (j=i; j<clientList.length-1; j++) {
				clientList[j] = clientList[j+1];
			}
			clientList.length--;

			// Put this id in a stack so that we can reuse old ids

			clientFifoQueue.pushLast(clientId);
			if (clientFifoQueue.numElements >= REUSE_ID_THRESHOLD) {
				pickingClientsFromFifoQueue = true;
			}

			console.log("Removed client " + clientId + ".");
			console.log("Number of clients is now " + clientList.length);
			console.log("Size of queue with available client ids: " + clientFifoQueue.numElements);
			break;
		}
	}
}

function closeSession(sessionId) {
	var i;
	var j;

	console.log("Close session ID " + sessionId);

	for (i=0; i<sessionList.length; i++) {
		if (sessionList[i].sessionId == sessionId) {
			for (j=0; j<sessionList[i].clientList.length; j++) {
				sessionList[i].clientList[j].socket.emit('sessionClosed', { sessionId: sessionId });
				sessionList[i].clientList[j].sessionId = -1;
			}

			for (j=i; j<sessionList.length-1; j++) {
				sessionList[j] = sessionList[j+1];
			}
			sessionList.length--;

			// Put this id in a stack so that we can reuse old ids

			sessionFifoQueue.pushLast(sessionId);
			if (sessionFifoQueue.numElements >= REUSE_ID_THRESHOLD) {
				pickingSessionsFromFifoQueue = true;
			}

			console.log("Size of queue with avail session ids: " + sessionFifoQueue.numElements);

			break;
		}
	}
}

// IO

io.sockets.on('connection', onConnectionNonSecure);
ioSecure.sockets.on('connection', onConnectionSecure);

function onConnectionNonSecure(socket) {
	console.log("onConnectionNonSecure");
	onConnectionCommon(socket);
}

function onConnectionSecure(socket) {
	console.log("onConnectionSecure");
	onConnectionCommon(socket);
}

function onConnectionCommon(socket) {
	if (MAX_TOTAL_NUMBER_OF_CLIENTS > 0 && clientList.length >= MAX_TOTAL_NUMBER_OF_CLIENTS-1) {
		console.log("A new client tried to connect but we have reached max number of clients");        
		socket.emit('connectionRejected', {"reason": "Max number of clients reached" });
		return;
	}

	var client;
	var newClientId;

	if (pickingClientsFromFifoQueue) {
		if (clientFifoQueue.numElements > 0) {
			newClientId = clientFifoQueue.popFirst();
			if (clientFifoQueue.numElements == 0) {
				pickingClientsFromFifoQueue = false;
			}
			if (newClientId == -1) {
				newClientId = currentClientId++;
			}
		}
	} else {
		newClientId = currentClientId++;
	}

	var client = new Client(socket, newClientId);

	clientList[clientList.length] = client;

	console.log("A new client connected. Assigned client id: " + client.clientId);
	console.log("Number of connected clients increased to " + clientList.length);
	console.log("Number of sessions: " + sessionList.length);

	// Send a connected message to the client and let it know its assigned client ID
	socket.emit('connected', {	id: client.clientId ,
								name: client.clientName });

	socket.on('disconnect', function () {
		var clientId = -1;

		console.log("Got disconnect message on one socket.");

		clientId = getClientIdBySocket(socket);
		if (clientId != -1) {
			console.log("It was client id " + clientId + " that disconnected. Remove this client");
			removeClientId(clientId);
		}
	});
	
	// This message is sent from a client hosting a session
	// to change the state of that session (to let the server know if other clients may join)
	// For example, clients may be allowed to join in the lobby but not while a game is ongoing
	socket.on('setSessionState', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			// Find the session where this client is host client
			var session = getSessionBySessionId(client.sessionId);
			if (session) {
				if (session.hostClientId == client.clientId) {
					session.sessionState = data.sessionState;
				}
			}
		}
	});

	// This message is sent from a client to tell the server it wants to create a new session
	socket.on('createSession', function (data) {
		if (MAX_NUMBER_OF_SESSIONS > 0 && sessionList.length >= MAX_NUMBER_OF_SESSIONS-1) {
			socket.emit('createSessionRejected', {"reason": "Max number of sessions reached" });
			return;
		}

		if (MAX_NUMBER_OF_CLIENTS_PER_SESSION > 0 &&
				data.maxNumberOfClients > MAX_NUMBER_OF_CLIENTS_PER_SESSION) {
			socket.emit('createSessionRejected', {"reason": "maxNumberOfClients is too large" });
			return;
		}

		var client = getClientBySocket(socket);
		if (client) {
			// If the client was already in a session, leave that session first
			if (client.sessionId != -1) {
				removeClientFromSession(client.clientId);
			}

			if (data.programName && data.programName != "" && data.sessionName && 
					data.sessionName != "") {
				var session;
				var newSessionId;

				if (pickingSessionsFromFifoQueue) {
					if (sessionFifoQueue.numElements > 0) {
						newSessionId = sessionFifoQueue.popFirst();
						if (sessionFifoQueue.numElements == 0) {
							pickingSessionsFromFifoQueue = false;
						}
						if (newSessionId == -1) {
							newSessionId = currentSessionId++;
						}
					}
				} else {
					newSessionId = currentSessionId++;
				}

				if (typeof data.isHiddenSession === 'undefined') {
					data.isHiddenSession = false;
				}

				if (typeof data.key === 'undefined') {
					data.key = "";
				}

				if (typeof data.sessionNeedsHostToLive === 'undefined') {
					data.sessionNeedsHostToLive = true;
				}

				if (typeof data.sessionNeedsClientsToLive === 'undefined') {
					data.sessionNeedsClientsToLive = true;
				}

				if (typeof data.sessionTimeoutMinutes === 'undefined') {
					data.sessionTimeoutMinutes = 4*60;
				}

				if (typeof data.sessionOpen === 'undefined') {
					data.sessionOpen = true;
				}

				if (typeof data.maxNumberOfClients === 'undefined') {
					data.maxNumberOfClients = 2;
				}

				var session = new Session(	newSessionId, client.clientId,
											data.programName, data.sessionName,
											data.maxNumberOfClients, data.sessionOpen,
											data.sessionNeedsHostToLive,
											data.sessionNeedsClientsToLive,
											data.sessionTimeoutMinutes,
											data.key, data.isHiddenSession);
				sessionList[sessionList.length] = session;

				// Now mark this client as belonging to this new session id
				client.sessionId = session.sessionId;
				client.programName = data.programName;

				console.log("Session created. Number of sessions is now " + sessionList.length);

				socket.emit('sessionCreated', {sessionId: session.sessionId });
			}
		}
	});

 	// This message is sent from a client to tell the server it is leaving a session
	socket.on('leaveSession', function (data) {
		console.log("Client " + data.id + " asked to leave session");  
		var clientId = getClientIdBySocket(socket);
		if (clientId != -1) {
			console.log("Removing client from session");  
			removeClientFromSession(clientId);
		}
	});

	// This message is sent from a client to tell the server it wants to join a specific session
	socket.on('joinSession', function (data) {
		var i;

		var sessionData = {
			clients: []
		};

		var client = getClientBySocket(socket);
		if (client) {

			console.log("Client " + client.clientId + " asking to join session " + data.sessionId);

			// If the client was already in a session, leave that session first
			if (client.sessionId != -1) {
				console.log("This client was already in a session, leave that session first");
				removeClientFromSession(client.clientId);
			}

			var hostClientId;
			var hostClientName;
			var session = getSessionBySessionId(data.sessionId);
			if (session) {
				hostClientId = session.hostClientId;
				hostClientName = getClientNameByClientId(hostClientId);	
				if (!hostClientName) {
					hostClientName = "";
				}

				console.log("Session " + data.sessionId + " is/was hosted by client " + 
					hostClientId + " (name " + hostClientName + ")");

				var rejected = false;
				var rejectReason = "";

				if (!session.sessionOpen) {
					rejected = true;
					rejectReason = "Session not open for joining";
				}

				if (session.maxNumberOfClients > 0 &&
						session.numberOfClients >= session.maxNumberOfClients) {
					rejected = true;
					rejectReason = "Session full";
				}

				if ((session.key && session.key != "") && (!data.key || data.key != session.key)) {
					rejected = true;
					rejectReason = "Session requires another key";
				}

				if (rejected) {
					console.log("Rejecting. Reason: " + rejectReason);

					socket.emit('joinSessionRejected', {	sessionId: data.sessionId,
															"reason": rejectReason});
					return;
				}

				session.clientList[session.clientList.length] = client;
				session.numberOfClients++;
				console.log("Added client to the session.");
				console.log("Number of clients in this session is now " + session.numberOfClients);

				if (session.timer) {
					console.log("This session had a timer. Clear the timer now");
					clearTimeout(session.timer);
					session.timer = null;
				}

				client.sessionId = data.sessionId;
				client.programName = session.programName;

				for (i=0; i<session.clientList.length; i++) {
					sessionData.clients.push({	"id"	: session.clientList[i].clientId,
												"name"	: session.clientList[i].clientName});
				}

				// Tell the client that it has successfully joined the session,
				// and let it know the ids of other clients in same session
				// Also, tell all the other clients in the same session that
				// this client has now joined

				socket.emit('joinSessionSuccess', { 	sessionId: data.sessionId,
														clients: sessionData.clients,
														hostClientId: hostClientId,
														hostClientName: hostClientName});

				for (i=0; i<session.clientList.length; i++) {
					if (session.clientList[i].clientId != client.clientId) {
						session.clientList[i].socket.emit('clientJoinedSession',
																{	id: client.clientId,
																	name: client.clientName});
					}
				}
			} else {
				console.log("Could not find this session");
			}
		}
	});

	// This message is sent from a client to ask the server which active sessions there are
	// for a specified program
	socket.on('sessionList', function (data) {
		var i;
		var j;

		var sessionData = {
			sessions: []
		};

		console.log("A client asked for the session list of programname + data.programName");
		console.log("There are " + sessionList.length + " sessions");

		if (typeof data.listAllSessions === 'undefined') {
			data.listAllSessions = false;
		}

		// Build up the array of sessions, to be sent to the clients
		for (i=0; i<sessionList.length; i++) {
			if (sessionList[i].programName == data.programName &&
					!sessionList[i].isHiddenSession) {
				// List open and non-full sessions, or all sessions if "listAllSessions" is set
				if (sessionList[i].sessionOpen || data.listAllSessions) {
					if (sessionList[i].maxNumberOfClients <= 0 ||
							sessionList[i].numberOfClients < sessionList[i].maxNumberOfClients || 
							data.listAllSessions) {

						var hostClientName = getClientNameByClientId(sessionList[i].hostClientId);
						if (!hostClientName) {
							hostClientName = "";
						}
						sessionData.sessions.push({ "sessionId": sessionList[i].sessionId,
													"sessionName": sessionList[i].sessionName,
													"hostClientId": sessionList[i].hostClientId,
													"hostClientName": hostClientName});
					}
				}
			}
		}
		socket.emit('sessionList', sessionData);
	});

	// This message is sent from one client to another client within a session
	socket.on('messageToClient', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var clientId = client.clientId;
			var sessionId = client.sessionId;
			if (sessionId != -1) {
				var i;
				var session = getSessionBySessionId(sessionId);
				if (session) {
					for (i=0; i<session.clientList.length; i++) {
						if (session.clientList[i].clientId == data.destinationId) {
							data.sourceId = clientId;
							session.clientList[i].socket.emit('messageToClient', data);
							if (!session.sessionNeedsClientsToLive) {
								session.cache[session.cache.length] = data;
							}
							return;
						}
					}
				}
			}
		}
	});

	// This message is sent from one client to all other clients within the same session
	socket.on('messageToAllClients', function (data) {
		var client = getClientBySocket(socket);
 		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				var i;
				data.sourceId = client.clientId;
				// Now go through the list of clients in that session and send the message to them
				for (i=0; i<sessionList[sessionIndex].clientList.length; i++) {
					if ((sessionList[sessionIndex].clientList[i].clientId != data.sourceId) ||
							(sessionList[sessionIndex].clientList[i].clientId == data.sourceId &&
								data.sendToSelf == true)) {
					    sessionList[sessionIndex].clientList[i].socket.emit('messageToAllClients', 
					    													data);
					}
				}
				if (!sessionList[sessionIndex].sessionNeedsClientsToLive) {
					sessionList[sessionIndex].cache[sessionList[sessionIndex].cache.length] = data;
				}
			} else {
				// Client tried to send message but client is not member of any session!
			}
		}
	});

	// The "name" message is sent from the client to let the server know the client's free-text name
	// The server will broadcast this name to the other clients in the same session
	socket.on('name', function (data) {

		// TODO: Should we enforce unique names?

		var client = getClientBySocket(socket);
		if (client) {
			client.clientName = data.name;
			// Inform the other clients in the same session about this name change
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				var i;
				// Now go through the list of clients in that session and send the message to them
				for (i=0; i<sessionList[sessionIndex].clientList.length; i++) {
					if (sessionList[sessionIndex].clientList[i] != client) {
						sessionList[sessionIndex].clientList[i].socket.emit('clientChangedName',
																	{	id: client.clientId,
																		name: client.clientName});
					}
				}
			}
		}
	});

	// TODO: EXPERIMENTAL...
	socket.on('getCache', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);

			if (sessionIndex != -1) {
				socket.emit('cache', {	"sessionId": sessionList[sessionIndex].sessionId,
										"cache": sessionList[sessionIndex].cache});
			}
		}
	});

	// TODO: EXPERIMENTAL...
	socket.on('getCacheLength', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				socket.emit('cacheLength', {"sessionId": sessionList[sessionIndex].sessionId,
											"cacheLength": sessionList[sessionIndex].cache.length});
			}
		}
	});

	// TODO: EXPERIMENTAL...
	socket.on('clearCache', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				sessionList[sessionIndex].cache = new Array();
			}
		}
	});

	// TODO: EXPERIMENTAL...
	socket.on('getMappedObject', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				if (typeof data.index !== 'undefined' && !isNaN(data.index)) {
					var mappedObject = sessionList[sessionIndex].map[data.index];
					console.log("socket emit mappedObject");
					socket.emit('mappedObject', {	index: data.index,
													object: mappedObject});
					}
			}
		}
	});

	// TODO: EXPERIMENTAL...
	socket.on('setMappedObject', function (data) {
		var client = getClientBySocket(socket);
		if (client) {
			var sessionIndex = getSessionIndexBySocket(socket);
			if (sessionIndex != -1) {
				if (typeof data.index !== 'undefined' && !isNaN(data.index) &&
						typeof data.object !== 'undefined') {
					sessionList[sessionIndex].map[data.index] = data.object;
				}
			}
		}
	});
}

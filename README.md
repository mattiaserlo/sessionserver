sessionserver
=============
This is a lightweight server app for letting clients create and join sessions, and send messages between each other.
Suitable applications are simple multiplayer games, chat applications, etc.

Short terminology:

* A "client" is a representation of a client that has connected to the server.
* Each client on the server will be assigned a unique client ID number.
* A "session" is a group of clients wanting to communicate with each other.
* Each session on the server will be assigned a unique session ID number.
* The server groups sessions in "applications".
* A client that has connected to the server can query ongoing sessions for a particular application.
* A "host client" is a client that has created a session.
* When creating a session, a host client can choose to use a password, so that only clients stating the same
password may join the session.

A typical scenario looks like this:

1. Two clients connect to the server individually. The server assigns them client ID 0 and client ID 1.
2. The users running client 0 and client 1 update their free text names, and share the names with the server.
3. Client 0 sends a "createSession" message to the server, stating application name "Tetris".
4. The server starts a session, assigns a unique session ID (0) to the session, and sends a "sessionCreated"
reply to client 0.
5. Client 1 sends a "sessionList" message to the server, stating application name "Tetris".
6. The server responds to client 1 with a "sessionList" message containing the ongoing Tetris sessions.
The list contains session ID 0 and its host client name.
7. Client 1 sends a "joinSession" message to the server, with session ID 0 as parameter.
8. The server sends a "joinSessionSuccess" message to client 1, containing an array of all clients in the same
session. The server also sends a "clientJoinedSession" message to client 0 to let it know that client 1 has joined.
9. Now client 0 and 1 can send messages to each other using "messageToClient" or "messageToAllClients".
They are aware of each other's IDs and use these IDs when they send messages to each other.
All messages go via the server.

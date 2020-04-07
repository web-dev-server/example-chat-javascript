var WebSocket = require('ws');
var fs = require('fs');
//var WebDevServer = require("web-dev-server");
var WebDevServer = require("../../../web-dev-server/build/lib/Server");

var App = function () {
	this.allowedSessionIds = {};
	this.httpServer = null;
	this.expressServer = null;
	this.wss = null;
	this.sessionParser = null;
	this.onlineUsers = {};
	this.onlineUsersCount = 0;
	this.data = [];
	this.typingUsers = {};
	this.users = { length: 0 };
};
App.LAST_CHAT_MESSAGES_TO_SEND = 100;
App.prototype = {
	Start (server, firstRequest, firstResponse) {
		console.log("Initializing websocket serverving:");
		this.wsServer = new WebSocket.Server({ server: server.GetHttpServer() });
		this.wsServer.on('connection', function (ws, req) {
			this.wsHandleConnection(ws, req)
		}.bind(this));
	},
	Stop (server) {
		console.log("Closing websocket serverving:");
		this.wsServer.close(function () {
			server.Stop();
		}.bind(this));
	},
	HttpHandle: function (request, response) {
		return new Promise(function (resolve, reject) {
			if (request.IsCompleted()) {
				this.httpRequestComplete(request, response, resolve, reject);
			} else {
				request.GetBody().then(function (body) {
					this.httpRequestComplete(request, response, resolve, reject);
				}.bind(this));
			}
		}.bind(this));
	},
	wsHandleConnection: function (ws, req) {
		WebDevServer.Session.Start(req).then(function (session) {
			var sessionId = session.GetId();
			var sessionNamespace = session.GetNamespace("chat");
			if (!sessionNamespace.authenticated) {
				console.log("Connected not authorized user with session id: '" + sessionId + "'.");
				ws.close(4000, 'Not authorized session.');
			}
			var id = sessionNamespace.id;
			var user = sessionNamespace.user;
			console.log("Connected authorized user with session id: '" + sessionId + "'.");
			this.sendToMyself('connection', {
				message: 'Welcome, you are connected.'
			}, ws);
			if (typeof(this.onlineUsers[id]) == 'undefined') {
				this.onlineUsers[id] = {
					sessionId: sessionId,
					user: user,
					ws: ws
				};
				this.onlineUsersCount++;
			}
			this.sendLastComunication(ws, sessionId);
			ws.on('message', function (str, bufferCont) {
				try {
					this.webSocketOnMessage(str, bufferCont, sessionId, ws);
				} catch (e) {
					console.log(e, e.stack);
				}
			}.bind(this));
			ws.on('close', this.webSocketOnClose.bind(this, sessionId));
			ws.on('error', this.webSocketOnError.bind(this, sessionId));
		}.bind(this));
	},
	webSocketOnMessage: function (str, bufferCont, sessionId, ws) {
		
		var sendedData = JSON.parse(str);
		var eventName = sendedData.eventName;
		var data = sendedData.data;
		var id = data.id;
		var user = data.user;
		
		if (eventName == 'login') {
			
			var onlineUsersToSendBack = {};
			for (var uid in this.onlineUsers) 
				onlineUsersToSendBack[uid] = this.onlineUsers[uid].user;
			
			this.sendToAll('login', {
				onlineUsers: onlineUsersToSendBack, 
				onlineUsersCount: this.onlineUsersCount, 
				id: id,
				user: user
			});
			
			console.log(user + ' joined the chat room');
			
		} else if (eventName == 'message') {
			
			var recepient = typeof(data.recepient) != 'undefined' && data.recepient
				? data.recepient 
				: 'all';
			
			if (recepient == 'all') {
				this.sendToAll('message', data);
			} else {
				if (typeof(this.onlineUsers[recepient]) != 'undefined')
					this.sendToSingle(
						'message', data, this.onlineUsers[recepient].sessionId
					);
				this.sendToMyself('message', data, ws);
			}
			console.log(data.user + ': ' + data.content);
		} else if (eventName == 'typing') {
			
			var recepient = typeof(data.recepient) != 'undefined' && data.recepient
				? data.recepient 
				: 'all';
			var typing = typeof(data.typing) != 'undefined'
				? data.typing 
				: false;
			
			this.typingUsers[user] = typing;
			
			if (recepient == 'all') {
				this.sendToAll('typing', this.typingUsers);
			} else {
				if (typeof(this.onlineUsers[recepient]) != 'undefined')
					this.sendToSingle(
						'typing', this.typingUsers, this.onlineUsers[recepient].sessionId
					);
			}
			console.log(data.user + ' is typing.');
		}
	},
	webSocketOnClose: function (sessionId) {
		// session id authorization boolean to false after user is disconnected
		this.allowedSessionIds[sessionId] = false;
		
		var onlineUser = {}, 
			userToDelete = {}, 
			uidToDelete = '';
		for (var uid in this.onlineUsers) {
			onlineUser = this.onlineUsers[uid];
			if (sessionId != onlineUser.sessionId) continue;
			userToDelete = onlineUser;
			uidToDelete = uid;
			break;
		}
		
		this.onlineUsersCount--;
		delete this.onlineUsers[uidToDelete];
		
		var onlineUsersToSendBack = {};
		for (var uid in this.onlineUsers) 
			onlineUsersToSendBack[uid] = this.onlineUsers[uid].user;
		
		this.sendToAll('logout', {
			onlineUsers: onlineUsersToSendBack, 
			onlineUsersCount: this.onlineUsersCount, 
			id: userToDelete.id,
			user: userToDelete.user
		});
		
		console.log("User '" + onlineUser.user + "' exited the chat room.");
	},
	webSocketOnError: function (sessionId) {
		// session id authorization boolean to false after user is disconnected
		this.allowedSessionIds[sessionId] = false;
		
		var onlineUser = {}, 
			userToDelete = {}, 
			uidToDelete = '';
		for (var uid in this.onlineUsers) {
			onlineUser = this.onlineUsers[uid];
			if (sessionId != onlineUser.sessionId) continue;
			userToDelete = onlineUser;
			uidToDelete = uid;
			break;
		}
		
		this.onlineUsersCount--;
		delete this.onlineUsers[uidToDelete];
		
		var onlineUsersToSendBack = {};
		for (var uid in this.onlineUsers) 
			onlineUsersToSendBack[uid] = this.onlineUsers[uid].user;
		
		this.sendToAllExceptMyself('logout', {
			onlineUsers: onlineUsersToSendBack, 
			onlineUsersCount: this.onlineUsersCount, 
			id: userToDelete.id,
			user: userToDelete.user
		});
		
		console.log("User '" + onlineUser.user + "' exited the chat room (connection error).");
	},
	sendToAll: function (eventName, data) {
		var response = {
			eventName: eventName,
			data: data
		};
		var responseStr = JSON.stringify(response);
		this.data.push(response);
		if (this.data.length > App.LAST_MESSAGES_TO_SEND)
			this.data.shift();
		var onlineUser = {};
		for (var userId in this.onlineUsers) {
			onlineUser = this.onlineUsers[userId];
			if (onlineUser.ws && onlineUser.ws.readyState === WebSocket.OPEN) {
				try {
					onlineUser.ws.send(responseStr);
				} catch (e) {}
			}
		}
	},
	sendToSingle: function (eventName, data, targetSessionId) {
		var response = {
			eventName: eventName,
			data: data
		};
		var responseStr = JSON.stringify(response);
		response.targetSessionId = targetSessionId;
		this.data.push(response);
		if (this.data.length > App.LAST_MESSAGES_TO_SEND)
			this.data.shift();
		var onlineUser = {};
		for (var userId in this.onlineUsers) {
			onlineUser = this.onlineUsers[userId];
			if (onlineUser.sessionId === targetSessionId) {
				if (onlineUser.ws && onlineUser.ws.readyState === WebSocket.OPEN) {
					try {
						onlineUser.ws.send(responseStr);
					} catch (e) {}
				}
				break;
			}
		}
	},
	sendToMyself: function (eventName, data, ws) {
		var responseStr = JSON.stringify({
			eventName: eventName,
			data: data
		});
		if (ws.readyState !== WebSocket.OPEN) return;
		try {
			ws.send(responseStr);
		} catch (e) {
			console.log(e);
		}
	},
	sendToAllExceptMyself: function (eventName, data, myselfSessionId) {
		var response = {
			eventName: eventName,
			data: data
		};
		var responseStr = JSON.stringify(response);
		this.data.push(response);
		if (this.data.length > App.LAST_MESSAGES_TO_SEND)
			this.data.shift();
		var onlineUser = {};
		for (var userId in this.onlineUsers) {
			onlineUser = this.onlineUsers[userId];
			if (onlineUser.sessionId !== targetSessionId) {
				if (onlineUser.ws && onlineUser.ws.readyState === WebSocket.OPEN) {
					try {
						onlineUser.ws.send(responseStr);
					} catch (e) {}
				}
				break;
			}
		}
	},
	httpRequestComplete: function (request, response, resolve, reject) {
		if (request.GetMethod() == 'POST' && request.HasParam('login-submit')) {
			if (this.users.length) {
				this.authenticateUser(request, response, resolve, reject);
			} else {
				this.loadCsvLoginData(function (users) {
					this.users = users;
					this.authenticateUser(request, response, resolve, reject);
				}.bind(this));
			}
		} else {
			response.SetBody('/* No autorization credentials sended. */').Send();
			resolve();
		}
	},
	authenticateUser: function (request, response, resolve, reject) {
		var user = request.GetParam("user", "\-\._@a-zA-Z0-9", "");
		var pass = request.GetParam("pass", "\-\._@a-zA-Z0-9", "");
		
		/***************************************************************************/
		/**                          CSV users comparation                        **/
		/***************************************************************************/
		if (this.users[user] && this.users[user].pass == pass) {
			// after session is authorized - set session id authorization boolean to true:
			var id = this.users[user].id;
			WebDevServer.Session.Start(request, response).then(function(session) {
				var sessionNamespace = session.GetNamespace("chat");

				sessionNamespace.id = id;
				sessionNamespace.user = user;
				sessionNamespace.authenticated = true;
				
				response.SetBody('{"success":true,"id":' + id + '}').Send();
				resolve();
			}.bind(this));
			
		} else {
			response.SetBody('{"success":false').Send();
			resolve();
		}
		/***************************************************************************/
			
	},
	loadCsvLoginData: function (cb) {
		fs.readFile (__dirname + '/login-data.csv', function (err, content) {
			var rows = content.toString().replace(/\r/g, '').split('\n'),
				result = {},
				length = 0;
			rows.shift();
			rows.forEach(function (row, i) {
				var data = row.split(';'),
					username = data[2];
				result[username] = {
					id: parseInt(data[0], 10),
					name: data[1],
					user: username,
					pass: data[3]
				};
				length += 1;
			});
			result.length = length;
			cb(result);
		});
	},
	sendLastComunication: function (ws, sessionId) {
		// send last n messages:
		if (this.data.length > 0) {
			var lastMessagesCount = App.LAST_CHAT_MESSAGES_TO_SEND, 
				response = {};
			for (
				var i = Math.max(this.data.length - 1 - lastMessagesCount, 0),
					l = Math.min(lastMessagesCount, this.data.length);
				i < l; 
				i += 1
			) {
				response = this.data[i];
				if (response.eventName !== 'message') continue;
				if (
					response.data.recepient != 'all' && 
					response.targetSessionId != sessionId
				) continue;
				ws.send(JSON.stringify(response));
			}
		}
	}
};

module.exports = App;
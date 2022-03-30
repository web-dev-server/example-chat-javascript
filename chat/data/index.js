var WebSocket = require('ws');
var fs = require('fs');
var WebDevServer = require("web-dev-server");
//var WebDevServer = require("../../../web-dev-server/build/lib/Server");

var App = function () {
	this.static = new.target;
	this.logger = null;
	this.httpServer = null;
	this.wsServer = null;
	this.onlineUsers = {};
	this.onlineUsersCount = 0;
	this.data = [];
	this.typingUsers = {};
	this.users = { length: 0 };
};
App.LAST_CHAT_MESSAGES_TO_SEND = 100;
App.SESSION_EXPIRATION_SECONDS = 60 * 30; // 30 minutes
App.SESSION_NAMESPACE_NAME = 'chat';
App.USERS_DATA_RELATIVE_PATH = '/login-data.csv';
App.LOGS_DIR_RELATIVE_PATH = '/../../logs';
App.ALL_USERS_RECEPIENT_NAME = 'all';
App.prototype = {
	
	Start (server, firstRequest, firstResponse) {
		this.logger = new WebDevServer.Tools.Logger(
			__dirname + this.static.LOGS_DIR_RELATIVE_PATH,
			server.GetDocumentRoot()
		);
		this.wsServer = new WebSocket.Server({
			server: server.GetHttpServer()
		});
		console.log("WebSocket server initialized.");
		this.wsServer.on('connection', this.handleWebSocketConnection.bind(this));
	},
	Stop (server) {
		this.wsServer.close(function () {
			server.Stop();
		}.bind(this));
		console.log("WebSocket server closed.");
	},

	HttpHandle: function (request, response) {
		return new Promise(function (resolve, reject) {
			if (request.IsCompleted()) {
				this.httpHandleRequestComplete(request, response, resolve, reject);
			} else {
				request.GetBody().then(function (body) {
					this.httpHandleRequestComplete(request, response, resolve, reject);
				}.bind(this));
			}
		}.bind(this));
	},
	httpHandleRequestComplete: function (request, response, resolve, reject) {
		WebDevServer.Session.Start(request, response).then(function(session) {
			var sessionNamespace = session.GetNamespace(this.static.SESSION_NAMESPACE_NAME);
			sessionNamespace.SetExpirationSeconds(this.static.SESSION_EXPIRATION_SECONDS);
			if (this.users.length) {
				this.httpHandleSendResponse(request, response, sessionNamespace, resolve, reject);
			} else {
				this.httpHandleLoadUsersCsv(reject, function (users) {
					this.users = users;
					this.httpHandleSendResponse(request, response, sessionNamespace, resolve, reject);
				}.bind(this));
			}
		}.bind(this));
	},
	httpHandleLoadUsersCsv: function (reject, cb) {
		fs.readFile (__dirname + this.static.USERS_DATA_RELATIVE_PATH, function (err, content) {
			if (err) 
				return reject(err);
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
	httpHandleSendResponse: function (request, response, sessionNamespace, resolve, reject) {
		try {
			var responseBody = this.httpHandleAuthUser(request, sessionNamespace);
			response.SetBody(JSON.stringify(responseBody)).Send();
			resolve();
		} catch (e) {
			reject(e);
		}
	},
	httpHandleAuthUser: function (request, sessionNamespace) {
		var ajaxResponse = {
			success: false,
			id: null,
			message: null
		}
		if (request.GetMethod() !== 'POST') {
			ajaxResponse.message = 'Wrong request method.';
		} else if (!request.HasParam('login-submit')) {
			ajaxResponse.message = 'No authentication credentials sent.';
		} else if (sessionNamespace.authenticated) {
			ajaxResponse.success = true;
			ajaxResponse.id = sessionNamespace.id;
			ajaxResponse.message = 'User is already authenticated.';
		} else {
			/***************************************************************************/
			/**                          CSV users comparation                        **/
			/***************************************************************************/
			var user = request.GetParam("user", "\-\._@a-zA-Z0-9", ""),
				pass = request.GetParam("pass", "\-\._@a-zA-Z0-9", "");
			if (this.users[user] == null) {
				ajaxResponse.message = 'User doesn\'t exist';
			} else if (this.users[user] != null && String(this.users[user].pass) !== String(pass)) {
				ajaxResponse.message = 'Wrong user password.';
			} else {
				
				var id = this.users[user].id;
				sessionNamespace.id = id;
				sessionNamespace.user = user;
				sessionNamespace.authenticated = true;
				
				ajaxResponse.success = true;
				ajaxResponse.id = id;
				ajaxResponse.message = "User has been authenticated.";

			}
			/***************************************************************************/
		}
		return ajaxResponse;
	},

	handleWebSocketConnection (socket, request) {
		var sessionId = request.GetCookie(WebDevServer.Session.GetCookieName(), "a-zA-Z0-9");
		if (sessionId == null) {
			console.log("Connected user with no session id.");
			return socket.close(4000, 'No session id.');
		}
		WebDevServer.Session.Exists(request).then(function (sessionExists) {
			if (!sessionExists) {
				console.log("Connected user with no started session (session id: '"+sessionId+"').");
				return socket.close(4000, 'No started session.');
			}
			WebDevServer.Session.Get(sessionId).then(function (session) {
				var sessionNamespace = session.GetNamespace(this.static.SESSION_NAMESPACE_NAME);
				sessionNamespace.SetExpirationSeconds(this.static.SESSION_EXPIRATION_SECONDS);
				if (!sessionNamespace.authenticated) {
					console.log("Connected not authorized user (session id: '"+sessionId+"').");
					return socket.close(4000, 'Not authorized session.');
				}
				var id = sessionNamespace.id,
					user = sessionNamespace.user;
				console.log("Connected authenticated user (user: '"+user+", session id: '"+sessionId+"').");
				this.sendToMyself('connection', {
					id: id,
					user: user,
					message: 'Welcome, you are connected.'
				}, socket);
				if (this.onlineUsers[id] == null) {
					this.onlineUsers[id] = {
						id: id,
						sessionId: sessionId,
						user: user,
						ws: socket
					};
					this.onlineUsersCount += 1;
				}
				this.sendLastComunication(socket, sessionId, id);
				socket.on('message', function (rawData, isBinary) {
					try {
						this.handleWebSocketOnMessage(rawData, socket);
					} catch (e) {
						if (e instanceof Error) {
							this.logger.Error(e);
						} else {
							console.error(e);
						}
					}
				}.bind(this));
				socket.on('close', this.handleWebSocketOnClose.bind(this, sessionId));
				socket.on('error', this.handleWebSocketOnError.bind(this, sessionId));
			}.bind(this));
		}.bind(this));
	},
	handleWebSocketOnMessage: function (rawData, socket) {
		var sendedData = JSON.parse(rawData.toString()),
			eventName = sendedData.eventName;
		
		if (eventName == 'login') {
			this.handleWebSocketOnChatLogin(sendedData.data);

		} else if (eventName == 'message') {
			this.handleWebSocketOnChatMessage(sendedData.data, socket);

		} else if (eventName == 'typing') {
			this.handleWebSocketOnChatTyping(sendedData.data);
			
		}
	},

	handleWebSocketOnChatLogin: function (data) {
		this.sendToAll('login', {
			onlineUsers: this.serializeOnlineUsers(), 
			onlineUsersCount: this.onlineUsersCount, 
			id: data.id,
			user: data.user
		});
		console.log("User '"+data.user+"' joined the chat room.");
	},
	handleWebSocketOnChatMessage: function (data, socket) {
		var recepientData = this.getWebSocketMessageRecepient(data),
			recepientName = recepientData.name,
			recepientId = recepientData.id,
			clientMsgData = {
				id: data.id,
				user: data.user,
				content: data.content,
				recepient: recepientName
			};
		
		if (recepientName == this.static.ALL_USERS_RECEPIENT_NAME) {
			this.sendToAll('message', clientMsgData);
			console.log("User '"+data.user+"' send message '"+data.content+"' to all users.");
		} else {
			if (this.onlineUsers[recepientId] != null) {
				console.log("User '"+data.user+"' send message '"+data.content+"' to user '"+recepientName+"'.");
				this.sendToSingle(
					'message', clientMsgData, 
					this.onlineUsers[recepientId].sessionId
				);
			} else {
				console.log("User '"+data.user+"' send message '"+data.content+"' to unknown user.");
			}
			this.sendToMyself('message', clientMsgData, socket);
		}
	},
	handleWebSocketOnChatTyping: function (data) {
		var typing = data.typing != null && data.typing;
		this.typingUsers[data.user] = typing;
		var recepientData = this.getWebSocketMessageRecepient(data),
			recepientName = recepientData.name,
			recepientId = recepientData.id;

		if (recepientName == this.static.ALL_USERS_RECEPIENT_NAME) {
			this.sendToAll('typing', this.typingUsers);
			console.log("User '"+data.user+"' send notification about typing to all users.");
		} else {
			if (this.onlineUsers[recepientId] != null) {
				console.log("User '"+data.user+"' send notification about typing to user '"+recepientName+"'.");
				this.sendToSingle(
					'typing', this.typingUsers, 
					this.onlineUsers[recepientId].sessionId
				);
			} else {
				console.log("User '"+data.user+"' send notification about typing to to unknown user.");
			}
		}
	},

	handleWebSocketOnClose: function (sessionId, code, reason) {
		var userToDelete = this.deleteOnlineUserBySessionId(sessionId);
		if (userToDelete == null) return;
		this.sendToAllExceptMyself('logout', {
			onlineUsers: this.serializeOnlineUsers(), 
			onlineUsersCount: this.onlineUsers.size, 
			id: userToDelete.id,
			user: userToDelete.user
		}, sessionId);
		console.log("User '"+userToDelete.user+"' exited the chat room (code: "+code+", reason: "+reason+").");
	},
	handleWebSocketOnError: function (sessionId) {
		this.logger.Error(err);
		var userToDelete = this.deleteOnlineUserBySessionId(sessionId);
		if (userToDelete == null) return;
		this.sendToAllExceptMyself('logout', {
			onlineUsers: this.serializeOnlineUsers(), 
			onlineUsersCount: this.onlineUsers.size, 
			id: userToDelete.id,
			user: userToDelete.user
		}, sessionId);
		console.log("User '"+userToDelete.user+"' exited the chat room because of an error.");
	},

	sendToAll: function (eventName, data) {
		var response = {
			eventName: eventName,
			data: data,
			live: true
		};
		var responseStr = JSON.stringify(response);
		delete response.live;
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
			data: data,
			live: true
		};
		var responseStr = JSON.stringify(response);
		delete response.live;
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
			data: data,
			live: true
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
			data: data,
			live: true
		};
		var responseStr = JSON.stringify(response);
		delete response.live;
		this.data.push(response);
		if (this.data.length > App.LAST_MESSAGES_TO_SEND)
			this.data.shift();
		var onlineUser = {};
		for (var userId in this.onlineUsers) {
			onlineUser = this.onlineUsers[userId];
			if (onlineUser.sessionId !== myselfSessionId) {
				if (onlineUser.ws && onlineUser.ws.readyState === WebSocket.OPEN) {
					try {
						onlineUser.ws.send(responseStr);
					} catch (e) {}
				}
				break;
			}
		}
	},

	sendLastComunication: function (ws, sessionId, currentUserId) {
		// send last n messages:
		if (this.data.length > 0) {
			var lastMessagesCount = App.LAST_CHAT_MESSAGES_TO_SEND, 
				response = {};
			for (
				var i = Math.min(this.data.length - 1 - lastMessagesCount, 0),
					l = Math.min(lastMessagesCount, this.data.length);
				i < l; 
				i += 1
			) {
				response = this.data[i];
				if (
					response.eventName !== 'message' && 
					response.eventName !== 'login' && 
					response.eventName !== 'logout'
				) 
					continue;
				if (
					response.targetSessionId == null ||
					response.targetSessionId === sessionId || 
					response.data.id === currentUserId
				) {
					ws.send(JSON.stringify({
						eventName: response.eventName,
						data: response.data,
						live: false
					}));
				}
			}
		}
	},

	serializeOnlineUsers: function () {
		var onlineUsers = {};
		for (var uid in this.onlineUsers) 
			onlineUsers[uid] = this.onlineUsers[uid].user;
		return onlineUsers;
	},
	getWebSocketMessageRecepient: function (data) {
		var recepientName = this.static.ALL_USERS_RECEPIENT_NAME,
			recepientId = null;
		if (data.recepient != null && String(data.recepient) != '') {
			recepientName =  data.recepient;
			if (this.users[recepientName] != null) 
				recepientId = this.users[recepientName].id;
		}
		return {name: recepientName, id: recepientId};
	},
	deleteOnlineUserBySessionId: function (sessionId) {
		var userToDelete = null,
			onlineUser = {};
		for (var userId in this.onlineUsers) {
			onlineUser = this.onlineUsers[userId];
			if (sessionId === onlineUser.sessionId) {
				userToDelete = onlineUser;
				break;
			}
		}
		if (userToDelete != null) {
			this.onlineUsersCount--;
			delete this.onlineUsers[userToDelete.id];
		} else {
			try {
				throw new Error("No user for session id '"+sessionId+"' to close socket connection.");
			} catch (e) {
				this.logger.Error(e);
			}
			return null;
		}
		return userToDelete;
	}
};

module.exports = App;
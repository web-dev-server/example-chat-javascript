var WebSocketServer = require('ws').Server,
	Url = require('url'),
	fs = require('fs');

var App = function (httpServer, expressServer, sessionParser, request, response) {
	this._init(httpServer, expressServer, sessionParser, request, response);
};
App.LAST_CHAT_MESSAGES_TO_SEND = 100;
App.prototype = {
	_allowedSessionIds: {},
	_httpServer: null,
	_expressServer: null,
	_wss: null,
	_sessionParser: null,
	_onlineUsers: {},
	_onlineUsersCount: 0,
	_data: [],
	_users: { length: 0 },
	_init: function (httpServer, expressServer, sessionParser, request, response) {
		this._httpServer = httpServer;
		this._expressServer = expressServer;
		this._sessionParser = sessionParser;
		console.log("Initializing websocket serverving:");
		this._wss = new WebSocketServer({ server: httpServer });
		this._wss.on('connection', this._webSocketConnectionHandler.bind(this));
	},
	_webSocketConnectionHandler: function (ws, req) {
		this._sessionParser(
			req, 
			{}, 
			this._webSocketSessionParsedHandler.bind(this, ws, req)
		);
	},
	_webSocketSessionParsedHandler: function (ws, req) {
		var sessionId = req.session.id;
		if (typeof(this._allowedSessionIds[sessionId]) == 'undefined') {
			console.log("Connected not authorized user with session id: " + sessionId);
			ws.close(4000, 'Not authorized session.');
			
		} else if (this._allowedSessionIds[sessionId]){
			console.log("Connected authorized user with session id: " + sessionId);
			this._sendToMyself('connection', {
				message: 'Welcome, you are connected.'
			}, ws);
			this._sendLastComunication(ws, sessionId);
			ws.on('message', function (str, bufferCont) {
				try {
					this._webSocketOnMessage(str, bufferCont, sessionId);
				} catch (e) {
					console.log(e, e.stack);
				}
			}.bind(this));
			ws.on('close', this._webSocketOnClose.bind(this, sessionId));
		}
	},
	_webSocketOnMessage: function (str, bufferCont, sessionId) {
		
		var sendedData = JSON.parse(str);
		var eventName = sendedData.eventName;
		var data = sendedData.data;
		var id = data.id;
		var user = data.user;
		
		if (eventName == 'login') {
			
			if (typeof(this._onlineUsers[id]) == 'undefined') {
				this._onlineUsers[id] = {
					sessionId: sessionId,
					user: user
				};
				this._onlineUsersCount++;
			}
			
			var onlineUsersToSendBack = {};
			for (var uid in this._onlineUsers) {
				onlineUsersToSendBack[uid] = this._onlineUsers[uid].user;
			}
			
			this._sendToAll('login', {
				onlineUsers: onlineUsersToSendBack, 
				onlineUsersCount: this._onlineUsersCount, 
				id: id,
				user: user
			});
			
			console.log(user + ' joined the chat room');
			
		} else if (eventName == 'message') {
			
			var recepient = typeof(data.recepient) != 'undefined' ? data.recepient : 'all';
			
			if (recepient == 'all') {
				this._sendToAll('message', data);
			} else {
				var targetSessionId = typeof(this._onlineUsers[recepient]) != 'undefined' ? this._onlineUsers[recepient].sessionId : '';
				this._sendToSingle('message', data, targetSessionId);
				this._sendToSingle('message', data, sessionId); // missing
			}
			console.log(data.user + ': ' + data.content);
		}
	},
	_webSocketOnClose: function (sessionId) {
		// session id authorization boolean to false after user is disconnected
		this._allowedSessionIds[sessionId] = false;
		
		var onlineUser = {}, userToDelete = {}, uidToDelete = '';
		for (var uid in this._onlineUsers) {
			onlineUser = this._onlineUsers[uid];
			if (sessionId != onlineUser.sessionId) continue;
			userToDelete = onlineUser;
			uidToDelete = uid;
			break;
		}
		
		this._onlineUsersCount--;
		delete this._onlineUsers[uidToDelete];
		
		var onlineUsersToSendBack = {};
		for (var uid in this._onlineUsers) {
			onlineUsersToSendBack[uid] = this._onlineUsers[uid].user;
		}
		
		this._sendToAll('logout', {
			onlineUsers: onlineUsersToSendBack, 
			onlineUsersCount: this._onlineUsersCount, 
			id: userToDelete.id,
			user: userToDelete.user
		});
		
		console.log(onlineUser.user + ' exited the chat room');
	},
	_sendToAll: function (eventName, data) {
		var response = {
			eventName: eventName,
			data: data
		}
		this._data.push(response);
		this._wss.clients.forEach(function (client) {
			client.send(JSON.stringify(response));
		});
	},
	_sendToSingle: function (eventName, data, targetSessionId) {
		var response = {
			eventName: eventName,
			data: data
		};
		var responseStr = JSON.stringify(response);
		response.targetSessionId = targetSessionId;
		this._data.push(response);
		this._wss.clients.forEach(function (client) {
			if (client.upgradeReq.sessionID == targetSessionId) {
				client.send(responseStr);
			}
		});
	},
	_sendToMyself: function (eventName, data, ws) {
		var responseStr = JSON.stringify({
			eventName: eventName,
			data: data
		});
		ws.send(responseStr);
	},
	httpRequestHandler: function (request, response, callback) {
		if (request.method == 'POST' && typeof(request.query['login-submit']) != 'undefined') {
			this._completeWholeRequestInfo(request, function (reqInfo) {
				if (this._users.length) {
					this._completeReqCredentialsAndTryToAuth(reqInfo, response, callback);
				} else {
					this._loadCsvLoginData(function (users) {
						this._users = users;
						this._completeReqCredentialsAndTryToAuth(reqInfo, response, callback);
					}.bind(this));
				}
			}.bind(this));
		} else {
			response.send('/* No autorization credentials sended. */');
			callback();
		}
	},
	_completeReqCredentialsAndTryToAuth: function (reqInfo, response, callback) {
		var request = reqInfo.request,
			urlParts, data;
		try {
			urlParts = Url.parse("http://localhost/?" + reqInfo.textBody, true);
			data = urlParts.query;
		} catch (e) { }
		if (typeof(data) != 'undefined' && data.user.length > 0 && data.pass.length > 0) {
			
			
			/***************************************************************************/
			/**                          CSV users comparation                        **/
			/***************************************************************************/
			if (this._users[data.user] && this._users[data.user].pass == data.pass) {
				// after session is authorized - set session id authorization boolean to true:
				this._allowedSessionIds[request.session.id] = true;
				
				request.session.authorized = true;
				request.session.save();
				
				response.send('{"success":true,"id":' + this._users[data.user].id + '}');
				callback();
			} else {
				response.send('{"success":false');
				callback();
			}
			/***************************************************************************/
			
			
			
		} else {
			response.send('{"success":false');
			callback();
		}			
	},
	_completeWholeRequestInfo: function (request, callback) {
        var reqInfo = {
            url: request.url,
            method: request.method,
            headers: request.headers,
            statusCode: request.statusCode,
            textBody: ''
        };
        var bodyArr = [];
        request.on('error', function (err) {
            console.error(err);
        }).on('data', function (chunk) {
            bodyArr.push(chunk);
        }).on('end', function () {
            reqInfo.textBody = Buffer.concat(bodyArr).toString();
            reqInfo.request = request;
            callback.call(this, reqInfo);
        }.bind(this));
    },
	_loadCsvLoginData: function (cb) {
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
	_sendLastComunication: function (ws, sessionId) {
		// send last n messages:
		if (this._data.length > 0) {
			var lastMessagesCount = App.LAST_CHAT_MESSAGES_TO_SEND, 
				response = {};
			for (
				var i = Math.max(this._data.length - 1 - lastMessagesCount, 0),
					l = Math.min(lastMessagesCount, this._data.length);
				i < l; 
				i += 1
			) {
				response = this._data[i];
				if (response.eventName !== 'message') continue;
				if (response.data.recepient != 'all' && response.targetSessionId != sessionId) continue;
				ws.send(JSON.stringify(response));
			}
		}
	}
};

module.exports = App;
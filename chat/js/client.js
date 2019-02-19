Class.Define('Chat', {
	Static: {
		ADDRESS: '%websocket.protocol%//%location.host%%location.pathname%data/'
	},
	Constructor: function () {
		this._initElements();
		this._initEvents();
		if (this._development) this._developmentAutoLogin();
	},
	_id: '',
	_user: '',
	_development: false,
	_initElements: function () {
		var $elm = function (id) { return document.getElementById(id) };
		this._loginForm = $elm("login-form");
		this._logoutBtn = $elm("logout-btn");
		this._chatRoom = $elm("chat-room");
		this._currentUser = $elm("current-user");
		this._onlineUsers = $elm("online-users");
		this._messages = $elm("messages");
		this._messageForm = $elm("message-form");
		this._recepients = $elm("recepients");
		this._audioElm = $elm("msg-sound");
		this._typingUsersCont = $elm("typing-users-cont");
		this._typingUsers = $elm("typing-users");
	},
	_initEvents: function () {
		var scope = this;
		this._loginForm.onsubmit = function (e) {
			return scope._loginSubmitHandler(e || window.event);
		};
		this._logoutBtn.onclick = function (e) {
			scope._socket.close();
			location.reload();
		};
		this._messageForm.onsubmit = function (e) {
			return scope._messageFormSubmitHandler(e || window.event);
		};
		this._messageForm.message.onkeydown = function (e) {
			e = e || window.event;
			if (e.keyCode == 13 && e.ctrlKey) {
				// enter + ctrl
				return scope._messageFormSubmitHandler(e || window.event);
			}
		};
		this._messageForm.message.onkeyup = function (e) {
			e = e || window.event;
			if (!(e.keyCode == 13 && e.ctrlKey)) {
				var messageText = scope._messageForm.message.value;
				return scope._messageFormTypingHandler(
					String(messageText).trim().length > 0, 
					e || window.event
				);
			}
		};
		window.addEventListener("unload", function(e) {
			if (this._socket)
				this._socket.close();
		}.bind(this));
		if (this._development) return;
		window.addEventListener("beforeunload", function(e) {
			return e.returnValue = "Do you realy want to leave chat?";
		});
	},
	_developmentAutoLogin: function () {
		var chrome = navigator.userAgent.indexOf('Chrome') > -1,
			firefox = navigator.userAgent.indexOf('Firefox') > -1;
		this._loginForm.user.value = chrome ? 'james.bond' : firefox ? 'moneypenny' : 'mr.white' ;
		this._loginForm.pass.value = '1234';
		if (document.createEvent) {
			var eventObject = document.createEvent('Event');
			eventObject.initEvent('submit', true, true);
			this._loginForm.dispatchEvent(eventObject);
		} else {
			this._loginForm.dispatchEvent(new Event('submit', {
				bubbles: true,
				cancelable: true
			}));
		}
	},
	_loginSubmitHandler: function (e) {
		var scope = this,
			user = this._loginForm.user.value,
			pass = this._loginForm.pass.value;
		if (user != '' && pass != '') {
			var pathName = location.pathname;
			var lastSlashPos = pathName.lastIndexOf('/');
			if (lastSlashPos > -1) 
				pathName = pathName.substr(0, lastSlashPos + 1);
			Ajax.load({
				url: location.origin + pathName + 'data/?login-submit',
				method: 'post',
				data: { 
					user: user,
					pass: pass
				},
				success: function (data, statusCode, xhr) {
					if (data.success) {
						scope._initChatRoom(user, data.id);
					} else {
						alert("Wrong login or password.");
					}
				},
				type: 'json',
				error: function (responseText, statusCode, xhr) {
					alert("Wrong username or password. See: ./chat/data/login-data.csv");
				}
			});
		}
		e.preventDefault();
		return false;
	},
	_initChatRoom: function (user, id) {
		this._loginForm.user.value = '';
		this._loginForm.pass.value = '';
		this._loginForm.style.display = 'none';
		this._chatRoom.style.display = 'block';
		
		this._id = id;
		this._user = user;
		this._currentUser.innerHTML = this._user;
		this._scrollToBottom();
		this._initChatWebSocketComunication();
	},
	_initChatWebSocketComunication: function () {
		var scope = this;
		// connect to server:
		this._socket = SocketWrapper.getInstance(
			this.self.ADDRESS
				.replace('%websocket.protocol%', location.protocol === 'https:' ? 'wss:' : 'ws:')
				.replace('%location.host%', location.host)
				.replace('%location.pathname%', location.pathname)
		);
		// tell the server to login this user:
		this._socket.send('login', {
			id: this._id, 
			user: this._user
		});
		// init web socket server events:
		this._socket.bind('login', function (data) {
			scope._anyUserLogInHandler(data);
		});
		this._socket.bind('logout', function (data) {
			scope._anyUserLogOutHandler(data);
		});
		this._socket.bind('message', function (data) {
			scope._addMessage(
				'content ' + (
					data.id == scope._id ? 'current' : 'other'
				),
				data.content,
				data.user
			);
			scope._audioElm.play();
		});
		this._socket.bind('typing', function (data) {
			scope._typingUsersHandler(data);
		});
	},
	_messageFormSubmitHandler: function (e) {
		var messageText = this._messageForm.message.value;
		if (messageText != '') {
			this._socket.send('message', {
				id: this._id,
				user: this._user,
				recepient: this._getRecepient(),
				content: messageText
			});
			this._messageForm.message.value = '';
		}
		e.preventDefault();
		return false;
	},
	_messageFormTypingHandler: function (typing, e) {
		this._socket.send('typing', {
			id: this._id,
			user: this._user,
			recepient: this._getRecepient(),
			typing: typing
		});
	},
	_getRecepient: function () {
		var recepientRadio = null, recepient = '';
		for (var i = 0, l = this._messageForm.rcp.length; i < l; i += 1) {
			recepientRadio = this._messageForm.rcp[i];
			if (recepientRadio.checked) {
				recepient = recepientRadio.value;
				break;
			}
		}
		return recepient;
	},
	_anyUserLogInHandler: function (data) {
		this._updateOnlineUsersHandler(data);
		this._addMessage(
			'notify', data.user + ' has joined chat'
		);
		this._updateRecepients(data.onlineUsers);
	},
	_anyUserLogOutHandler: function (data) {
		this._updateOnlineUsersHandler(data);
		this._addMessage(
			'notify', data.user + ' has leaved chat'
		);
		this._updateRecepients(data.onlineUsers);
	},
	_addMessage: function (msgClass, msgContent, msgAutor) {
		var msg = document.createElement('div');
		msg.className = 'message ' + msgClass;
		msg.innerHTML = '<div>' + msgContent + '</div>';
		if (msgAutor) msg.innerHTML += '<span>' + msgAutor + '</span>';
		this._messages.appendChild(msg);
		this._scrollToBottom();
	},
	_updateOnlineUsersHandler: function (data) {
		var onlineUsers = data.onlineUsers,
			html = '', separator = '';
		for (key in onlineUsers) {
			if (onlineUsers.hasOwnProperty(key)){
				html += separator + onlineUsers[key];
				separator = ', ';
			}
		}
		this._onlineUsers.innerHTML = 'Currently online (' 
			+ data.onlineUsersCount + ')： ' + html;
	},
	_typingUsersHandler: function (data) {
		var typingUsers = [];
		for (var userName in data) 
			if (userName !== this._user && data[userName])
				typingUsers.push(userName);
		if (typingUsers.length === 0) {
			this._typingUsersCont.style.display = 'none';
		} else {
			this._typingUsers.innerHTML = typingUsers.join(', ');
			this._typingUsersCont.style.display = 'block';
		}
	},
	_updateRecepients: function (onlineUsers) {
		var html = '';
		console.log(onlineUsers);
		for (var id in onlineUsers) {
			if (id == this._id) continue;
			html += '<div>'
				+'<input id="rcp-' + id + '" type="radio" name="rcp" value="' + id + '" />'
				+'<label for="rcp-' + id + '">' + onlineUsers[id] + '</label>'
			+'</div>';
		}
		this._recepients.innerHTML = html;
	},
	_scrollToBottom:function(){
		this._messages.scrollTop = this._messages.scrollHeight;
	}
});

window.chat = new Chat();
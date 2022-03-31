Class.Define('Chat', {
	Static: {
		AJAX_LOGIN_ADDRESS: '%location.protocol%//%location.host%%location.pathname%js/server/app/?login-submit',
		WEB_SOCKETS_ADDRESS: '%websocket.protocol%//%location.host%%location.pathname%js/server/app/'
	},

	_development: false,
	_id: '',
	_user: '',
	_socket: null,

    _loginForm: null,
    _loginUserElm: null,
    _loginPassElm: null,
    _logoutBtn: null,
    _chatRoom: null,
    _currentUser: null,
    _onlineUsers: null,
    _messages: null,
    _messageForm: null,
	_recepientsElms: null,
    _messageElm: null,
    _recepients: null,
    _audioElm: null,
    _typingUsersCont: null,
    _typingUsers: null,

	Constructor: function () {
		this._initElements();
		this._initEvents();
		if (this._development) {
            this._initAutoLoginDevelopment();
		} else {
			this._initAutoLogin();
		}
	},

	_initElements: function () {
		var $ = function (id) { return document.getElementById(id); };
		this._loginForm = $("login-form");
        this._loginUserElm = this._loginForm.user;
        this._loginPassElm = this._loginForm.pass;
		this._logoutBtn = $("logout-btn");
		this._chatRoom = $("chat-room");
		this._currentUser = $("current-user");
		this._onlineUsers = $("online-users");
		this._messages = $("messages");
		this._messageForm = $("message-form");
		this._recepients = $("recepients");
		this._initElementRecepients();
        this._messageElm = this._messageForm.message;
        this._recepients = $("recepients");
		this._audioElm = $("msg-sound");
		this._typingUsersCont = $("typing-users-cont");
		this._typingUsers = $("typing-users");
	},
	_initElementRecepients: function () {
		var rcp = this._messageForm.rcp;
		this._recepientsElms = rcp instanceof HTMLInputElement
			? [rcp]
			: rcp ;
	},
	_initEvents: function () {
		this._loginForm.addEventListener('submit', this._handleClientLoginFormSubmit.bind(this));
		this._logoutBtn.addEventListener('click', function (e) {
			this._socket.send('logout', {
				id: this._id,
				user: this._user
			});
			this._socket.close();
			location.reload();
		}.bind(this));
		this._messageForm.addEventListener('submit', this._handleClientMessageFormSubmit.bind(this));
		this._messageElm.addEventListener('keydown', function (e) {
			// enter + ctrl
			if (e.keyCode == 13 && e.ctrlKey) 
				return this._handleClientMessageFormSubmit(e);
		}.bind(this));
		this._messageElm.addEventListener('keyup', function (e) {
			// enter + ctrl
			if (!(e.keyCode == 13 && e.ctrlKey)) {
				return this._handleClientMessageFormTyping(
					String(this._messageElm.value).trim().length > 0, e
				);
			}
		}.bind(this));
		window.addEventListener('unload', function (e) {
            if (this._socket)
                this._socket.Close();
        }.bind(this));
        if (this._development)
            return;
        window.addEventListener('beforeunload', function (e) {
            return e.returnValue = "Do you realy want to leave chat?";
        });
	},
	_initAutoLogin: function () {
		Ajax.load({
			url: this._getLoginUrl(),
			method: 'POST',
			success: function (data, statusCode, xhr) {
				if (data.success) 
					this._initChatRoom(String(data.user), Number(data.id));
			}.bind(this),
			type: 'json'
		});
	},
	_initAutoLoginDevelopment: function () {
		var chrome = navigator.userAgent.indexOf('Chrome') > -1,
			firefox = navigator.userAgent.indexOf('Firefox') > -1;
			this._loginUserElm.value = chrome 
				? 'james.bond' 
				: (firefox 
					? 'money.penny' 
					: 'mr.smith');
			this._loginPassElm.value = '1234';
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

	_handleClientLoginFormSubmit: function (e) {
		var user = this._loginUserElm.value,
			pass = this._loginPassElm.value;
		if (user != '' && pass != '') {
			Ajax.load({
				url: this._getLoginUrl(),
				method: 'POST',
				data: { 
					user: user,
					pass: pass
				},
				success: function (data, statusCode, xhr) {
					if (data.success) {
						this._initChatRoom(user, data.id);
					} else {
                        alert(data.message);
					}
				}.bind(this),
				type: 'json',
				error: function (responseText, statusCode, xhr) {
                    alert(responseText);
				}
			});
		}
		e.preventDefault();
	},

	_initChatRoom: function (user, id) {
        this._id = id;
        this._user = user;
		this._initChatRoomElements();
		this._initChatRoomEvents();
	},
	_initChatRoomElements: function () {
        this._loginUserElm.value = '';
        this._loginPassElm.value = '';
        this._loginForm.style.display = 'none';
        this._chatRoom.style.display = 'block';
        this._currentUser.innerHTML = this._user;
        this._scrollToBottom();
	},
	_initChatRoomEvents: function () {
		var scope = this;
		// connect to server:
		this._socket = SocketWrapper.getInstance(
			this.static.WEB_SOCKETS_ADDRESS
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
		this._socket.bind('connection', function (data) {
			console.log(data.message);
		});
		this._socket.bind('login', this._handleServerUserLogin.bind(this));
		this._socket.bind('logout', this._handleServerUserLogout.bind(this));
		this._socket.bind('message', function (data, live) {
			scope._addMessage(
				'content ' + (
					data.id == scope._id ? 'current' : 'other'
				),
				data.content,
				data.user,
				data.recepient
			);
			if (live) scope._audioElm.play();
		});
		this._socket.bind('typing', this._handleServerUserTyping.bind(this));
	},

	_handleClientMessageFormSubmit: function (e) {
		var messageText = this._messageElm.value;
		if (messageText != '') {
			this._socket.send('message', {
				id: this._id,
				user: this._user,
				recepient: this._getRecepient(),
				content: messageText
			});
			this._messageElm.value = '';
		}
		e.preventDefault();
	},
	_handleClientMessageFormTyping: function (typing, e) {
		this._socket.send('typing', {
			id: this._id,
			user: this._user,
			recepient: this._getRecepient(),
			typing: typing
		});
	},
	_handleServerUserLogin: function (data, live) {
		if (live) this._updateOnlineUsers(data);
		if (!live || (live && data.id !== this._id)) 
			this._addMessage('notify', data.user + ' has joined chat');
		if (live) this._updateRecepients(data.onlineUsers);
	},
	_handleServerUserLogout: function (data, live) {
		if (live) this._updateOnlineUsers(data);
		this._addMessage('notify', data.user + ' has leaved chat');
		if (live) this._updateRecepients(data.onlineUsers);
	},
	_handleServerUserTyping: function (data) {
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

	_updateOnlineUsers: function (data) {
		var onlineUsers = data.onlineUsers,
			html = '', 
			separator = '';
		for (key in onlineUsers) {
			if (onlineUsers.hasOwnProperty(key)){
				html += separator + onlineUsers[key];
				separator = ', ';
			}
		}
		this._onlineUsers.innerHTML = 'Currently online (' 
			+ data.onlineUsersCount + ')： ' + html;
	},
	_updateRecepients: function (onlineUsers) {
		var html = '', 
			idInt = 0, 
			userName = '';
		for (var idStr in onlineUsers) {
			idInt = parseInt(idStr, 10);
			if (idInt === this._id) continue;
			userName = onlineUsers[idStr];
			html += '<div>'
				+'<input id="rcp-' + idStr + '" type="radio" name="rcp" value="' + userName + '" />'
				+'<label for="rcp-' + idStr + '">' + userName + '</label>'
			+'</div>';
		}
		this._recepients.innerHTML = html;
		this._initElementRecepients();
	},
	_addMessage: function (msgClass, msgContent, msgAutor, msgRecepient) {
		var msg = document.createElement('div');
		msg.className = 'message ' + msgClass;
		msg.innerHTML = '<div>' + msgContent + '</div>';
		if (msgAutor) {
			if (msgRecepient != null && msgRecepient != '') {
				msg.innerHTML += '<span>' + msgAutor + ' to ' + msgRecepient + '</span>';
			} else {
				msg.innerHTML += '<span>' + msgAutor + ' to all</span>';
			}
		}
		this._messages.appendChild(msg);
		this._scrollToBottom();
	},

	_getRecepient: function () {
		var recepientRadio = null, 
			recepient = '';
		for (var i = 0, l = this._recepientsElms.length; i < l; i += 1) {
			recepientRadio = this._recepientsElms[i];
			if (recepientRadio.checked) {
				recepient = recepientRadio.value;
				break;
			}
		}
		return recepient;
	},
	_getLoginUrl: function () {
		return this.static.AJAX_LOGIN_ADDRESS
			.replace('%location.protocol%', location.protocol)
			.replace('%location.host%', location.host)
			.replace('%location.pathname%', location.pathname);
	},
	_scrollToBottom:function () {
		this._messages.scrollTop = this._messages.scrollHeight;
	}
});

window.chat = new Chat();
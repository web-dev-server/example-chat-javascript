var SocketWrapper = function (url) {
	this._url = url;
	this._init();
};
SocketWrapper.RECONNECT_TIMEOUT = 1000; // 1s
SocketWrapper._instances = {};
SocketWrapper.getInstance = function (url) {
	if (typeof(SocketWrapper._instances[url]) == 'undefined') {
		SocketWrapper._instances[url] = new SocketWrapper(url);
	};
	return SocketWrapper._instances[url];
};
SocketWrapper.prototype = {
	_socket: null,
	_opened: false,
	_sendQueue: [],
	_callbacks: {},
	send: function (eventName, data, live) {
		live = live != null ? live : true;
		var str = JSON.stringify({eventName: eventName, data: data, live: live});
		//console.log(this._opened, str);
		if (this._opened) {
			this._socket.send(str);
		} else {
			this._sendQueue.push(str);
		};
		return this;
	},
	close: function (code, reason) {
		this._socket.close(code || 1000, reason || 'transaction complete');
	},
	bind: function (eventName, callback) {
		if (typeof(this._callbacks[eventName]) == 'undefined') {
			this._callbacks[eventName] = [];
		}
		this._callbacks[eventName].push(callback);
		return this;
	},
	unbind: function (eventName, callback) {
		if (typeof(this._callbacks[eventName]) == 'undefined') {
			this._callbacks[eventName] = [];
		}
		var callbacks = this._callbacks[eventName], cb = function () {};
		for (var i = 0, l = callbacks.length; i < l; i++) {
			cb = callbacks[i];
			if (cb == callback) {
				delete this._callbacks[eventName][i];
				break;
			}
		}
		if (this._callbacks[eventName].length == 0) {
			delete this._callbacks[eventName];
		};
		return this;
	},
	_init: function () {
		if (this._connect()) {
			this._socket.addEventListener('open', this._onOpenHandler.bind(this));
			this._socket.addEventListener('error', this._onErrorHandler.bind(this));
			this._socket.addEventListener('close', this._onCloseHandler.bind(this));
			this._socket.addEventListener('message', this._onMessageHandler.bind(this));
		}
	},
	_connect: function () {
		var r = true;
		try {
			this._socket = new WebSocket(this._url);
		} catch (e) {
			console.log(e);
			r = false;
		}
		return r;
	},
	_onOpenHandler: function (event) {
		var eventName = 'open', 
			callbacks = [];
		try {
			this._opened = true;
			if (typeof(this._callbacks[eventName]) != 'undefined') {
				this._processCallbacks(this._callbacks[eventName], [event]);
			}
			if (this._sendQueue.length) {
				for (var i = 0, l = this._sendQueue.length; i < l; i++) 
					this._socket.send(this._sendQueue[i]);
				this._sendQueue = [];
			}
		} catch (e) {
			console.error(e);
		}
	},
	_onErrorHandler: function (event) {
		var eventName = 'error', callbacks = [], intId = 0;
    	this._opened = false;
	    if (typeof(this._callbacks[eventName]) != 'undefined') {
	    	this._processCallbacks(this._callbacks[eventName], [event]);
	    }
	    intId = setInterval(function(){
	    	if (this._connect()) {
	    		clearInterval(intId);
	    	};
	    }.bind(this), SocketWrapper.RECONNECT_TIMEOUT);
	},
	_onCloseHandler: function (event) {
    	var eventName = 'close', callbacks = [];
    	this._opened = false;
	    if (typeof(this._callbacks[eventName]) != 'undefined') {
	    	this._processCallbacks(this._callbacks[eventName], [event]);
	    }
	},
	_onMessageHandler: function (event) {
	    var result = [],
	    	eventName = '',
	    	data = null,
			live = true;;
		try {
			result = JSON.parse(event.data);
			eventName = result.eventName;
			data = result.data;
			live = result.live != null ? result.live : true;
		} catch (e) {
			console.log(e, e.stack);
		}
		if (!eventName) {
			console.log("Server data should be in JS array formated like: ['eventName', {any:'data',as:'object'}]");
		} else if (typeof(this._callbacks[eventName]) != 'undefined') {
	    	this._processCallbacks(this._callbacks[eventName], [data, live]);
	    } else {
	    	console.log("No callback found for socket event: '" + eventName + "', url: '" + this._url + "'.", data);
	    }
	},
	_processCallbacks: function (callbacks, args) {
		var cb = function () {};
		for (var i = 0, l = callbacks.length; i < l; i++) {
			cb = callbacks[i];
			cb.apply(null, args);
		}
	}
};
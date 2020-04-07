# Example - Chat

[![Latest Stable Version](https://img.shields.io/badge/Stable-v3.0.0-brightgreen.svg?style=plastic)](https://github.com/web-dev-server/chat-example-pure-js/releases)
[![License](https://img.shields.io/badge/Licence-BSD-brightgreen.svg?style=plastic)](https://github.com/web-dev-server/chat-example-pure-js/blob/master/LICENCE.md)

Chat example with session authentication. Client scripts written with pure Javascript, no framework needed.

## Instalation
```shell
git clone https://github.com/web-dev-server/chat-example-pure-js.git example-chat-pure-js
cd ./example-chat-pure-js
npm update
```

## Usage
```shell
node server.js
```
- open your first web browser on:
  - http://localhost:8000/chat/
  - login with any user and password located in `./chat/data/login-data.csv`
- open your second web browser on:
  - http://localhost:8000/chat/
  - login with any user and password located in `./chat/data/login-data.csv`
- chat between browsers

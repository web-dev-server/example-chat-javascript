var WebDevServer = require("web-dev-server");
var devServerInstance = (new WebDevServer())
	.SetDocumentRoot(__dirname) // required
	.SetPort(8000)              // optional, 8000 by default
	// .SetDomain('localhost')  // optional, localhost by default
	// .SetDevelopment(false)   // optional, true by default to display Errors and directory content
	.Run();
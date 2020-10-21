const portfinder = require("portfinder");
const dnode = require("dnode");
const { Discover } = require("../");

const ddnode = module.exports = function (options) {
	const self = this,
		nodes = this.nodes = {},
		clients = this.clients = {},
		servers = this.servers = {},
		mergedClientBlock = this.mergedClientBlock = {},
		mergedServerBlock = this.mergedServerBlock = {};

	self.options = options = options || {};

	if (!options.serverBlock && !options.clientBlock) {
		const tmp = options;

		options = {
			serverBlock: tmp,
			clientBlock: tmp,
		};
	}

	options.serverBlock = options.serverBlock || {};
	options.clientBlock = options.clientBlock || options.serverBlock || {};

	//use portfinder to find an open port to which we will bind dnode
	portfinder.getPort(function (err, port) {
		console.log(port);

		if (err) {
			console.log(err);
			return;
		}

		const d = new Discover({ mastersRequired: 0 });

		d.advertise({
			dnode: { port: port },
		});

		options.serverBlock.__id__ = d.broadcast.processUuid;

		const server = dnode(options.serverBlock);

		server.listen("0.0.0.0", port, function (client, conn) {
			clients[client.__id__] = {
				remote: client,
				connection: conn,
				node: nodes[client.__id__],
			};

			self.mergeFunctions(client, "client");

			conn.on("end", function () {
				delete clients[client.__id__];
				delete nodes[client.__id__];
			});
		});

		d.on("added", function (node) {
			nodes[node.id] = node;

			//if the node is advertising dnode, connect to it.
			if (node.advertisement.dnode && node.advertisement.dnode.port) {
				const client = dnode(options.clientBlock);

				//connect to the server, passing it our block of functions
				client.connect(node.address, node.advertisement.dnode.port, function (server, conn) {
					servers[server.__id__] = {
						remote: server,
						connection: conn,
						node: nodes[server.__id__],
					};

					self.mergeFunctions(server, "server");

					conn.on("end", function () {
						delete servers[server.__id__];
						delete nodes[server.__id__];
					});
				});
			}

		});

		d.on("removed", function (node) {
			delete nodes[node.id];
		});
	});
};

ddnode.prototype.mergeFunctions = function (block, clientOrServer) {
	const self = this;

	const destinationBlock = (clientOrServer == "server") ? self.mergedServerBlock : self.mergedClientBlock;

	for (const key in block) {
	(function (key) {
		const val = block[key];

		if (typeof(val) == 'function' && !destinationBlock[key]) {

			//define a function which will proxy to each remotes's function
			destinationBlock[key] = function () {
				const args = Array.prototype.slice.call(arguments);
				let callback = null;

				if (typeof(args[args.length -1]) == 'function') {
					//the last argument to this function is a callback function
					callback = args.pop();
				}

				self[(clientOrServer == 'server') ? 'eachServer' : 'eachClient'](function (client) {
					//HACK: make sure the client/server has a reference to it's proper node object; this should be done sooner
					client.node = self.nodes[client.remote.__id__];

					if (client.remote[key]) {
						const nodeArgs = [].concat(args);

						if (callback) {
							//push a callback function onto the node specific args array
							nodeArgs.push(function () {
								const responseArgs = Array.prototype.slice.call(arguments);

								//append the client to the arguments
								responseArgs.push(client);

								callback.apply(self, responseArgs);
							});
						}

						client.remote[key].apply(client.remote, nodeArgs)
					}
				});
			}
		}
	})(key);
	}
};

ddnode.prototype.eachClient = function (fn) {
	const self = this;

	for (const uuid in self.clients) {
		fn(self.clients[uuid]);
	}
};

ddnode.prototype.eachServer = function (fn) {
	const self = this;

	for (const uuid in self.servers) {
		fn(self.servers[uuid]);
	}
};

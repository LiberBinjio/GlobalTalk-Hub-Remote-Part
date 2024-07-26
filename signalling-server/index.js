/**
 * A simple signalling server implementation using socket.io.
 * This socket connection is used a signalling server as WebRTC does not support discovery of other peers.
 * User's audio, video & chat messages does not use this socket.
 */

const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
	cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*" },
});
const path = require("path");

// 配置静态文件目录为项目根目录
app.use(express.static(path.join(__dirname, '..')));

// 路由处理器处理根路径请求
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const util = require("util");

// Get PORT from env variable else assign 3000 for development
const PORT = process.env.PORT || 3000;

server.listen(PORT, null, () => {
	console.log("Talk server started");
	console.log({ port: PORT, node_version: process.versions.node });
});

// 管理频道、套接字和对等方
const channels = {};
const sockets = {};
const peers = {};

const options = { depth: null, colors: true };

// 处理新连接的信令服务器逻辑
const signallingServer = (socket) => {
	const clientAddress = socket.handshake.address;

	socket.channels = {}; // 存储此套接字加入的频道
	sockets[socket.id] = socket;

	console.log("[" + socket.id + "] connection accepted");

	// 处理断开连接
	socket.on("disconnect", () => {
		for (const channel in socket.channels) {
			part(channel);
		}
		console.log("[" + socket.id + "] disconnected");
		delete sockets[socket.id];
	});

	// 处理用户加入频道
	socket.on("join", (config) => {
		console.log("[" + socket.id + "] join ", config);
		const channel = clientAddress + config.channel;

		// 已经加入了该频道
		if (channel in socket.channels) return;

		if (!(channel in channels)) {
			channels[channel] = {};
		}

		if (!(channel in peers)) {
			peers[channel] = {};
		}

		peers[channel][socket.id] = {
			userData: config.userData,
		};

		console.log("[" + socket.id + "] join - connected peers grouped by channel", util.inspect(peers, options));

		for (const id in channels[channel]) {
			channels[channel][id].emit("addPeer", {
				peer_id: socket.id,
				should_create_offer: false,
				channel: peers[channel],
			});
			socket.emit("addPeer", { peer_id: id, should_create_offer: true, channel: peers[channel] });
		}

		channels[channel][socket.id] = socket;
		socket.channels[channel] = channel;
	});

	// 更新用户数据
	socket.on("updateUserData", async (config) => {
		const channel = clientAddress + config.channel;
		const key = config.key;
		const value = config.value;
		for (let id in peers[channel]) {
			if (id == socket.id) {
				peers[channel][id]["userData"][key] = value;
			}
		}
		console.log("[" + socket.id + "] updateUserData", util.inspect(peers[channel][socket.id], options));
	});

	// 处理离开频道
	const part = (channel) => {
		// Socket not in channel
		if (!(channel in socket.channels)) return;

		delete socket.channels[channel];
		delete channels[channel][socket.id];

		delete peers[channel][socket.id];
		if (Object.keys(peers[channel]).length == 0) {
			// last peer disconnected from the channel
			delete peers[channel];
		}
		console.log("[" + socket.id + "] part - connected peers grouped by channel", util.inspect(peers, options));

		for (const id in channels[channel]) {
			channels[channel][id].emit("removePeer", { peer_id: socket.id });
			socket.emit("removePeer", { peer_id: id });
		}
	};

	// 处理ICE候选者的转发
	socket.on("relayICECandidate", (config) => {
		let peer_id = config.peer_id;
		let ice_candidate = config.ice_candidate;

		if (peer_id in sockets) {
			sockets[peer_id].emit("iceCandidate", { peer_id: socket.id, ice_candidate: ice_candidate });
		}
	});

	// 处理会话描述的转发
	socket.on("relaySessionDescription", (config) => {
		let peer_id = config.peer_id;
		let session_description = config.session_description;

		if (peer_id in sockets) {
			sockets[peer_id].emit("sessionDescription", {
				peer_id: socket.id,
				session_description: session_description,
			});
		}
	});
};

io.sockets.on("connection", signallingServer);

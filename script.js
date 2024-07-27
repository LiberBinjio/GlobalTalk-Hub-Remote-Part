/* globals attachMediaStream, Vue, peers, localMediaStream, dataChannels, signalingSocket */

"use strict";

// 处理 URL 中的房间 ID
const searchParams = new URLSearchParams(window.location.search);
let roomId = searchParams.get("room");

if (!roomId) {
	// 生成随机房间 ID
	roomId = Math.random().toString(36).substr(2, 6);
	searchParams.set("room", roomId);
	window.location.search = searchParams.toString();
}

// 创建 Vue 实例
const App = Vue.createApp({
	data() {
		return {
			peerId: "",
			roomId: roomId,
			roomLink: "",
			copyText: "",
			userAgent: "",
			isMobileDevice: false,
			isTablet: false,
			isIpad: false,
			isDesktop: false,
			videoDevices: [],
			audioDevices: [],
			audioEnabled: false,
			videoEnabled: false,
			screenShareEnabled: false,
			showChat: false,
			showSettings: false,
			hideToolbar: true,
			selectedAudioDeviceId: "",
			selectedVideoDeviceId: "",
			name: window.localStorage.name,
			typing: "",
			chats: [],
			callInitiated: false,
			callEnded: false,
		};
	},
	methods: {
		// 初始化通话
		initiateCall() {
			if (!this.roomId) return this.showNotification("Invalid room id");
			if (!this.name) return this.showNotification("Invalid name");

			this.callInitiated = true;
			window.initiateCall();
		},
		// 确保摄像头和麦克风处于禁用状态
		if (localMediaStream) {
			localMediaStream.getAudioTracks().forEach(track => track.enabled = this.audioEnabled);
			localMediaStream.getVideoTracks().forEach(track => track.enabled = this.videoEnabled);
		},
		// 复制房间链接
		copyURL() {
			navigator.clipboard.writeText(this.roomLink).then(
				() => {
					this.copyText = "Copied 👍";
					setTimeout(() => (this.copyText = ""), 3000);
				},
				(err) => console.error(err)
			);
		},
		// 切换音频状态
		audioToggle(e) {
			e.stopPropagation();
			localMediaStream.getAudioTracks()[0].enabled = !localMediaStream.getAudioTracks()[0].enabled;
			this.audioEnabled = !this.audioEnabled;
			this.updateUserData("audioEnabled", this.audioEnabled);
		},
		// 切换视频状态
		videoToggle(e) {
			e.stopPropagation();
			localMediaStream.getVideoTracks()[0].enabled = !localMediaStream.getVideoTracks()[0].enabled;
			this.videoEnabled = !this.videoEnabled;
			this.updateUserData("videoEnabled", this.videoEnabled);
		},
		// 切换自视频镜像
		toggleSelfVideoMirror() {
			document.querySelector("#videos .video #selfVideo").classList.toggle("mirror");
		},
		// 更新用户名
		updateName() {
			window.localStorage.name = this.name;
		},
		// 更新用户名并发布
		updateNameAndPublish() {
			window.localStorage.name = this.name;
			this.updateUserData("peerName", this.name);
		},
		// 显示通知
		showNotification(message) {
			const notificationContainer = document.getElementById("notification-container");
			if (notificationContainer) {
				const notification = document.createElement("div");
				notification.className = "notification";
				notification.innerText = message;
				notificationContainer.appendChild(notification);
				// 4秒后开始淡出
				setTimeout(() => {
					notification.classList.add("fade-out");
				}, 4000);
				// 7秒后移除通知
				setTimeout(() => {
					notificationContainer.removeChild(notification);
				}, 7000);
			} else {
				console.error("Notification container not found.");
			}
		},
		// 切换屏幕共享状态
		screenShareToggle(e) {
			e.stopPropagation();
			let screenMediaPromise;
			if (!App.screenShareEnabled) {
				if (navigator.getDisplayMedia) {
					screenMediaPromise = navigator.getDisplayMedia({ video: true });
				} else if (navigator.mediaDevices.getDisplayMedia) {
					screenMediaPromise = navigator.mediaDevices.getDisplayMedia({ video: true });
				} else {
					screenMediaPromise = navigator.mediaDevices.getUserMedia({
						video: { mediaSource: "screen" },
					});
				}
			} else {
				screenMediaPromise = navigator.mediaDevices.getUserMedia({ video: true });
				document.getElementById(this.peerId + "_videoEnabled").style.visibility = "hidden";
			}
			screenMediaPromise
				.then((screenStream) => {
					this.screenShareEnabled = !this.screenShareEnabled;
					// 这下面两行没必要，原先开着视频的话关共享屏幕继续开视频，原先没开视频为什么关共享屏幕自动开视频了呢？
					// this.videoEnabled = true;
					// this.updateUserData("videoEnabled", this.videoEnabled);
					// 替换当前视频轨道	
					for (let peer_id in peers) {
						const sender = peers[peer_id].getSenders().find((s) => (s.track ? s.track.kind === "video" : false));
						sender.replaceTrack(screenStream.getVideoTracks()[0]);
					}
					screenStream.getVideoTracks()[0].enabled = true;
					const newStream = new MediaStream([screenStream.getVideoTracks()[0], localMediaStream.getAudioTracks()[0]]);
					localMediaStream = newStream;
					attachMediaStream(document.getElementById("selfVideo"), newStream);
					this.toggleSelfVideoMirror();

					screenStream.getVideoTracks()[0].onended = function () {
						if (this.screenShareEnabled) this.screenShareToggle();
					};
					try {
						if (cabin) {
							cabin.event("screen-share-" + App.screenShareEnabled);
						}
					} catch (e) {}
				})
				.catch((e) => {
					this.showNotification("Unable to share screen. Please use a supported browser.");
					console.error(e);
				});
		},
		// 更新用户数据
		updateUserData(key, value) {
			this.sendDataMessage(key, value);

			switch (key) {
				case "audioEnabled":
					document.getElementById(this.peerId + "_audioEnabled").className =
						"audioEnabled icon-mic" + (value ? "" : "-off");
					break;
				case "videoEnabled":
					document.getElementById(this.peerId + "_videoEnabled").style.visibility = value ? "hidden" : "visible";
					break;
				case "peerName":
					document.getElementById(this.peerId + "_videoPeerName").innerHTML = value + " (you)";
					break;
				default:
					break;
			}
		},
		// 更换摄像头
		changeCamera(deviceId) {
			navigator.mediaDevices
				.getUserMedia({ video: { deviceId: deviceId } })
				.then((camStream) => {
					console.log(camStream);

					this.videoEnabled = true;
					this.updateUserData("videoEnabled", this.videoEnabled);

					for (let peer_id in peers) {
						const sender = peers[peer_id].getSenders().find((s) => (s.track ? s.track.kind === "video" : false));
						sender.replaceTrack(camStream.getVideoTracks()[0]);
					}
					camStream.getVideoTracks()[0].enabled = true;

					const newStream = new MediaStream([camStream.getVideoTracks()[0], localMediaStream.getAudioTracks()[0]]);
					localMediaStream = newStream;
					attachMediaStream(document.getElementById("selfVideo"), newStream);
					this.selectedVideoDeviceId = deviceId;
				})
				.catch((err) => {
					console.log(err);
					this.showNotification("Error while swaping camera");
				});
		},
		// 更换麦克风
		changeMicrophone(deviceId) {
			navigator.mediaDevices
				.getUserMedia({ audio: { deviceId: deviceId } })
				.then((micStream) => {
					this.audioEnabled = true;
					this.updateUserData("audioEnabled", this.audioEnabled);

					for (let peer_id in peers) {
						const sender = peers[peer_id].getSenders().find((s) => (s.track ? s.track.kind === "audio" : false));
						sender.replaceTrack(micStream.getAudioTracks()[0]);
					}
					micStream.getAudioTracks()[0].enabled = true;

					const newStream = new MediaStream([localMediaStream.getVideoTracks()[0], micStream.getAudioTracks()[0]]);
					localMediaStream = newStream;
					attachMediaStream(document.getElementById("selfVideo"), newStream);
					this.selectedAudioDeviceId = deviceId;
				})
				.catch((err) => {
					console.log(err);
					this.showNotification("Error while swaping microphone");
				});
		},
		// 安全化字符串
		sanitizeString(str) {
			const tagsToReplace = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
			const replaceTag = (tag) => tagsToReplace[tag] || tag;
			const safe_tags_replace = (str) => str.replace(/[&<>]/g, replaceTag);
			return safe_tags_replace(str);
		},
		// 将字符串转换为链接
		linkify(str) {
			return this.sanitizeString(str).replace(/(?:(?:https?|ftp):\/\/)?[\w/\-?=%.]+\.[\w/\-?=%]+/gi, (match) => {
				let displayURL = match.trim().replace("https://", "").replace("https://", "");
				displayURL = displayURL.length > 25 ? displayURL.substr(0, 25) + "&hellip;" : displayURL;
				const url = !/^https?:\/\//i.test(match) ? "http://" + match : match;
				return `<a href="${url}" target="_blank" class="link" rel="noopener">${displayURL}</a>`;
			});
		},
		// 编辑消息内容
		edit(e) {
			this.typing = e.srcElement.textContent;
		},
		// 粘贴消息内容
		paste(e) {
			e.preventDefault();
			const clipboardData = e.clipboardData || window.clipboardData;
			const pastedText = clipboardData.getData("Text");
			document.execCommand("inserttext", false, pastedText.replace(/(\r\n\t|\n|\r\t)/gm, " "));
		},
		// 发送聊天消息
		sendChat(e) {
			e.stopPropagation();
			e.preventDefault();

			if (!this.typing.length) return;

			if (Object.keys(peers).length > 0) {
				const composeElement = document.getElementById("compose");
				this.sendDataMessage("chat", this.typing);
				this.typing = "";
				composeElement.textContent = "";
				composeElement.blur;
			} else {
				this.showNotification("No peers in the room");
			}
		},
		// 发送数据消息
		sendDataMessage(key, value) {
			const dataMessage = {
				type: key,
				name: this.name,
				id: this.peerId,
				message: value,
				date: new Date().toISOString(),
			};

			switch (key) {
				case "chat":
					this.chats.push(dataMessage);
					this.$nextTick(this.scrollToBottom);
					break;
				default:
					break;
			}

			Object.keys(dataChannels).map((peer_id) => dataChannels[peer_id].send(JSON.stringify(dataMessage)));
		},
		// 处理传入的数据通道消息
		handleIncomingDataChannelMessage(dataMessage) {
			switch (dataMessage.type) {
				case "chat":
					this.showChat = true;
					this.hideToolbar = false;
					this.chats.push(dataMessage);
					this.$nextTick(this.scrollToBottom);
					break;
				case "audioEnabled":
					document.getElementById(dataMessage.id + "_audioEnabled").className =
						"audioEnabled icon-mic" + (dataMessage.message ? "" : "-off");
					break;
				case "videoEnabled":
					document.getElementById(dataMessage.id + "_videoEnabled").style.visibility = dataMessage.message
						? "hidden"
						: "visible";
					break;
				case "peerName":
					document.getElementById(dataMessage.id + "_videoPeerName").innerHTML = dataMessage.message;
					break;
				default:
					break;
			}
		},
		// 滚动到聊天底部
		scrollToBottom() {
			const chatContainer = this.$refs.chatContainer;
			chatContainer.scrollTop = chatContainer.scrollHeight;
		},
		// 格式化日期
		formatDate(dateString) {
			const date = new Date(dateString);
			const hours = date.getHours() > 12 ? date.getHours() - 12 : date.getHours();
			return (
				(hours < 10 ? "0" + hours : hours) +
				":" +
				(date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes()) +
				" " +
				(date.getHours() >= 12 ? "PM" : "AM")
			);
		},
		// 设置样式
		setStyle(key, value) {
			document.documentElement.style.setProperty(key, value);
		},
		// 通话反馈
		onCallFeedback(e) {
			try {
				if (cabin) {
					cabin.event(e.target.getAttribute("data-cabin-event"));
				}
			} catch (e) {}
		},
		// 退出通话
		exit() {
			signalingSocket.close();
			for (let peer_id in peers) {
				peers[peer_id].close();
			}
			this.callEnded = true;
		},
	},
}).mount("#app");

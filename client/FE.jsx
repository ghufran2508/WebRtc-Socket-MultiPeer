/* eslint-disable no-unused-vars */
import React, { useCallback, useRef, useState } from "react";
import { useSocket } from "../../../Context/SocketProvider";
import { Link, useLocation } from "react-router-dom";
import OrganizationContext from "Context/Organization";
import { Box } from "@mui/system";
import styles from "./style";
import { IconButton } from "@mui/material";
import { Videocam, VideocamOff } from "@mui/icons-material";
import ReactPlayer from "react-player";
import { PropTypes } from 'prop-types'
class PeerService {
    constructor() {
        if (!this.peer) {
            this.peer = new RTCPeerConnection({
                iceServers: [
                    {
                        urls: [
                            "stun:stun.l.google.com:19302",
                            "stun:global.stun.twilio.com:3478",
                        ],
                    },
                ],
            });
        }
    }

    async getAnswer(offer) {
        if (this.peer) {
            if (this.peer.signalingState !== "stable") {
                console.warn(`Unexpected signaling state: ${this.peer.signalingState}`);
                return;
            }
            await this.peer.setRemoteDescription(offer);
            const ans = await this.peer.createAnswer();
            await this.peer.setLocalDescription(new RTCSessionDescription(ans));
            return ans;
        }
    }

    async setRemoteDescription(ans) {
        if (this.peer) {
            if (this.peer.signalingState !== "have-local-offer") {
                console.warn(`Unexpected signaling state: ${this.peer.signalingState}`);
                return null;
            }
            await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
        }
    }

    async generateOffer() {
        if (this.peer) {
            const offer = await this.peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await this.peer.setLocalDescription(new RTCSessionDescription(offer));
            return offer;
        }
    }
}

const RoomPage = () => {
    const socket = useSocket();
    const location = useLocation();
    const [participantsArray, setParticipantsArray] = useState([]);
    const [retryCallCount, setRetryCallCount] = useState(0);
    const [peersData, setPeersData] = useState({});
    const [sender, setSender] = useState({});

    const [cameraOn, setCameraOn] = useState(false);

    const [remoteStream, setRemoteStream] = useState({});

    const VideoStreamRef = React.useRef(null);
    const videoRef = React.useRef(null);

    const { userAuth } = React.useContext(OrganizationContext);
    const room = location.pathname.split("/").pop();

    // clean up
    React.useEffect(() => {
        return () => {
            // Clean up streams on unmount
            if (VideoStreamRef && VideoStreamRef.current) {
                VideoStreamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, [VideoStreamRef]);

    const handleCameraToggle = async () => {
        if (!cameraOn) {
            // time to turn camera on
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                });
                VideoStreamRef.current = stream;
                videoRef.current.srcObject = stream;

                Object.keys(peersData).forEach((key) => {
                    handleCallUser(key);

                    socket.emit("user:camera:toogle", { id: socket.id, state: 'on', room })
                })
            } catch (error) {
                console.error("Error accessing video:", error);
            }
        } else {
            if (VideoStreamRef.current) {
                const tracks = VideoStreamRef.current
                    .getTracks()
                    .filter((track) => track.kind === "video");
                tracks.forEach((track) => track.stop());
                if (tracks.length === VideoStreamRef.current.getTracks().length) {
                    // Stop entire stream if only video
                    VideoStreamRef.current = null;
                    videoRef.current.srcObject = null;
                }

                socket.emit("user:camera:toogle", { id: socket.id, state: 'off', room })

                // Close peer connections
                if (sender) {
                    Object.keys(peersData).forEach((key) => {
                        try {
                            const peer = peersData[key];
                            peer.peer.removeTrack(sender[key]);
                        }
                        catch (error) {
                            console.log(error, key, sender[key]);
                        }
                    });
                }

            }
        }

        setCameraOn((prevCameraOn) => !prevCameraOn);
    };

    const handleUserJoined = useCallback(
        ({ email, displayName, photoURL, id }) => {
            console.log(`Email ${email} joined room`);
            setParticipantsArray((prev) => [
                ...prev,
                { email, displayName, photoURL, id },
            ]);
            let newPeer = peersData;
            newPeer[id] = new PeerService();
            setPeersData(newPeer);

            if (VideoStreamRef && VideoStreamRef.current) {
                setTimeout(async () => {
                    handleCallUser(id, newPeer[id]);
                }, 500)
                // Send current stream to the new peer
            }
        },
        [peersData, setParticipantsArray, VideoStreamRef, socket]
    );

    const handleUserLeave = ({ email, id }) => {
        console.log(`Email ${email} leave the room`);
        setParticipantsArray((prev) => prev.filter((v) => v.email !== email));
        setPeersData((peers) => {
            const peer = peers[id];
            peer.peer.close();
            delete peers[id];
            return peers
        });
        setRemoteStream((prev) => ({ ...prev, [id]: null }));
    }

    const handleParticipants = ({
        participantsId,
        participants: participantsData,
    }) => {
        const filter = participantsData.filter((p) => p.email !== userAuth.email);

        if (JSON.stringify(filter) !== JSON.stringify(participantsArray)) {
            setTimeout(() => {
                filter.forEach((participant) => {
                    setPeersData((prev) => ({
                        ...prev,
                        [participant.id]: new PeerService(),
                    }));
                });
                setParticipantsArray(filter);
            }, 100);
        }
    };

    const handleJoinRoom = useCallback(async () => {
        const { email, displayName, photoURL } = userAuth;

        socket.emit("room:join", {
            email,
            displayName,
            photoURL,
            room,
        });
    }, []);

    const handleCallUser = useCallback(async (to, selectedPeer) => {
        console.log("Calling...", to);
        if (selectedPeer) {
            console.log('selected peer', selectedPeer)
            const offer = await selectedPeer.generateOffer();
            socket.emit("user:call", { to, offer })
        }
        else if (peersData[to] !== undefined) {
            console.log('normal peer', peersData[to])
            const peer = peersData[to];
            const offer = await peer.generateOffer();
            socket.emit("user:call", { to, offer });
        }
    }, [peersData, setParticipantsArray]);

    const handleIncommingCall = useCallback(
        async ({ from, offer }) => {
            console.log(`Incoming Call`, from, offer, peersData[from]);
            const peer = peersData[from];
            const ans = await peer.getAnswer(offer);
            socket.emit("call:accepted", { to: from, ans });
        },
        [peersData]
    );

    const handleCallAccepted = useCallback(
        async ({ from, ans }) => {
            try {
                console.log("Call Response", from, peersData[from]);
                const peer = peersData[from];
                const res = await peer.setRemoteDescription(ans)
                if (res === null && retryCallCount < 3) {
                    handleCallUser(from, peer)
                    setRetryCallCount((prev) => prev + 1)
                }
                else {
                    console.log("Call Accepted!");
                    sendStreams(from);
                    setRetryCallCount(0)
                }
            }
            catch (err) {
                console.log(err);
            }
        },
        [peersData]
    );

    const sendStreams = useCallback((to) => {
        if (!VideoStreamRef.current) return;
        let sender = null;
        console.log("Sending stream to", to);

        const peer = peersData[to];

        VideoStreamRef.current.getTracks().forEach((track) => {
            sender = peer.peer.addTrack(track, VideoStreamRef.current);
        });


        setSender((prev) => ({ ...prev, [to]: sender }));
    }, [VideoStreamRef.current, peersData]);


    const handleNegoNeeded = useCallback(async (from) => {
        console.log("Nego needed", peersData[from]);
        const peer = peersData[from];
        const offer = await peer.generateOffer();
        socket.emit("peer:nego:needed", { offer, to: from });
    }, [peersData]);

    const handleNegoNeedIncomming = useCallback(
        async ({ from, offer }) => {
            try {
                console.log(`Nego needed Incoming from ${from}`, peersData[from]);
                setRemoteStream((prev) => ({
                    ...prev,
                    [from]: null
                }));
                const peer = peersData[from];
                const ans = await peer.getAnswer(offer);
                socket.emit("peer:nego:done", { to: from, ans });
            } catch (err) {
                console.log(err);
            }
        },
        [peersData, socket]
    );

    const handleNegoNeedFinal = useCallback(async ({ from, ans }) => {
        console.log(`Nego needed final from ${from}`, peersData[from]);
        try {
            const peer = peersData[from];
            await peer.setRemoteDescription(ans);
        }
        catch (err) {
            console.log(err);
        }
    }, [peersData, socket]);

    React.useEffect(() => {
        Object.keys(peersData).forEach((key) => {
            const peer = peersData[key];
            peer.peer.addEventListener("negotiationneeded", () => {
                ((key) => {
                    handleNegoNeeded(key)
                })(key)
            }
            );
            peer.peer.addEventListener("iceconnectionstatechange", (e) => {
                ((key) => {
                    console.log('ice state changed', e);
                    if (peer.peer.iceConnectionState === "disconnected") {
                        console.log("Disconnected");
                        setPeersData((prev) => {
                            prev[key].peer.close();
                            delete prev[key];
                            return { ...prev };
                        });
                    }
                })(key)
            });
        });

        return () => {
            Object.keys(peersData).forEach((key) => {
                const peer = peersData[key];
                peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
                peer.peer.removeEventListener("iceconnectionstatechange", () => { });
            });
        };
    }, [handleNegoNeeded]);

    React.useEffect(() => {
        Object.keys(peersData).forEach((key) => {
            const peer = peersData[key];
            peer.peer.addEventListener("track", async (ev) => {
                ((key) => {
                    console.log(key);
                    const newRemoteStream = ev.streams;
                    console.log("GOT TRACKS!!", newRemoteStream);
                    setRemoteStream((prev) => (
                        {
                            ...prev,
                            [key]: newRemoteStream[0]

                        }
                    ));
                })(key);
            });
        });
    }, [peersData])

    const handleRemoteCameraToogle = ({ id, state }) => {
        console.log('remote camera toogle', id, state);
        // if (state === 'on') { }
        if (state === 'off') {
            setRemoteStream((prev) => ({
                ...prev,
                [id]: null
            }));
        }
    }

    React.useEffect(() => {
        socket.on("user:joined", handleUserJoined);
        socket.on("user:update", handleParticipants);
        socket.on("user:leave", handleUserLeave);
        socket.on("incomming:call", handleIncommingCall);
        socket.on("call:accepted", handleCallAccepted);
        socket.on("peer:nego:needed", handleNegoNeedIncomming);
        socket.on("peer:nego:final", handleNegoNeedFinal);
        socket.on("user:camera:toogle", handleRemoteCameraToogle);

        return () => {
            socket.off("user:joined", handleUserJoined);
            socket.off("user:update", handleParticipants);
            socket.off("user:leave", handleUserLeave);
            socket.off("incomming:call", handleIncommingCall);
            socket.off("call:accepted", handleCallAccepted);
            socket.off("peer:nego:needed", handleNegoNeedIncomming);
            socket.off("peer:nego:final", handleNegoNeedFinal);
            socket.off("user:camera:toogle", handleRemoteCameraToogle);
        };
    }, [
        socket,
        handleUserJoined,
        handleParticipants,
        handleUserLeave,
        handleIncommingCall,
        handleCallAccepted,
        handleNegoNeedIncomming,
        handleNegoNeedFinal,
        handleRemoteCameraToogle
    ]);

    React.useEffect(() => {
        if (socket && socket.connected === false) {
            socket.connect();
            handleJoinRoom();
        }

        return () => {
            Object.keys(peersData).forEach((key) => {
                const peer = peersData[key];
                if (peer) {
                    peer.peer.close();
                }
            });
            console.log("Leaving Meet: ", userAuth.email);
            socket.emit("room:leave", { room });
            socket.disconnect();
        };
    }, []);

    console.log("My Socket Address: ", socket.id)
    console.log("peers data: ", peersData);
    console.log("remote streams: ", remoteStream)
    console.log("sender: ", sender)

    return (
        <div>
            <h1>Room Page</h1>
            <video id="temp" autoPlay width={"100px"} />
            <Link to={"/dashboard/interview"}>Go Back</Link>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-around",
                    flexWrap: "wrap",
                    flexDirection: "column",
                }}
            >
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "8px",
                        width: "400px",
                        flexWrap: "wrap",
                        m: 2,
                    }}
                >
                    {userAuth.email}
                    <img src={userAuth.photoURL} rel="no-referrer" />

                    <video autoPlay ref={videoRef} width={"100px"} height={"100px"} />
                </Box>

                <ParticipantBox
                    participantsArray={participantsArray}
                    remoteStream={remoteStream}
                />

                <Box sx={styles.micAndCameraBox}>
                    <IconButton
                        sx={styles.cameraBtn(cameraOn)}
                        onClick={handleCameraToggle}
                    >
                        {cameraOn ? <Videocam /> : <VideocamOff />}
                    </IconButton>
                </Box>
            </div>
        </div>
    );
};

export default RoomPage;
function ParticipantBox({ participantsArray, remoteStream }) {

    React.useEffect(() => {
        console.log("Participants array: ", participantsArray);
    }, [remoteStream])

    return (
        <>
            {participantsArray.map((participant) => (
                <Box
                    key={participant.id}
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "8px",
                        width: "400px",
                        flexWrap: "wrap",
                        m: 2,
                    }}
                >
                    {participant.email}
                    <img src={participant.photoURL} rel="no-referrer" />

                    <ReactPlayer
                        height={"100px"}
                        width={"100px"}
                        playing
                        url={remoteStream[participant.id]}
                        muted
                    />
                </Box>
            ))}</>
    )
}

ParticipantBox.propTypes = {
    participantsArray: PropTypes.array.isRequired,
    remoteStream: PropTypes.object.isRequired,
};

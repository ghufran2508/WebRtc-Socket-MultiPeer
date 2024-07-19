import React, { useCallback, useRef, useState } from "react";
import {
  CallEnd,
  Chat,
  Mic,
  MicOff,
  MoreVert,
  RadioButtonChecked,
  ScreenShare,
  StopScreenShare,
  Videocam,
  VideocamOff,
} from "@mui/icons-material";
import {
  Avatar,
  Badge,
  Box,
  Button,
  IconButton,
  Typography,
} from "@mui/material";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import ChatModal from "./chatModal";
import style from "./style";
import AddCardIcon from "@mui/icons-material/AddCard";
import { ProfileEditTextField } from "@infostacks/ui-components";
import PeopleDrawer from "./peopleDrawer";
import PeerService from "service/peer";
import { useSocket } from "Context/SocketProvider";
import { useLocation } from "react-router-dom";
import OrganizationContext from "Context/Organization";
import { PropTypes } from "prop-types";

const JoinMeeting = ({ setSteps }) => {
  const socket = useSocket();
  const location = useLocation();
  const [participantsArray, setParticipantsArray] = useState([]);
  const [retryCallCount, setRetryCallCount] = useState(0);
  const [peersData, setPeersData] = useState({});
  const [sender, setSender] = useState({});

  const [remoteStream, setRemoteStream] = useState({});

  const { userAuth } = React.useContext(OrganizationContext);
  const room = location.pathname.split("/").pop();

  const [isMicOn, setIsMicOn] = React.useState(false);
  const [isCameraOn, setIsCameraOn] = React.useState(false);
  const [isRecorded, setIsRecorded] = React.useState(false);
  const [isScreenShareOn, setIsScreenShareOn] = React.useState(true);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isAddOnsVisible, setIsAddOnsVisible] = React.useState(false);
  const [isPeopleDrawerOpen, setIsPeopleDrawerOpen] = React.useState(false);

  const videoRef = useRef(null);
  const VideoStreamRef = React.useRef(null);

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
    if (!isCameraOn) {
      // time to turn camera on
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        VideoStreamRef.current = stream;
        videoRef.current.srcObject = stream;

        Object.keys(peersData).forEach((key) => {
          handleCallUser(key);

          socket.emit("user:camera:toogle", {
            id: socket.id,
            state: "on",
            room,
          });
        });
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

        socket.emit("user:camera:toogle", {
          id: socket.id,
          state: "off",
          room,
        });

        // Close peer connections
        if (sender) {
          Object.keys(peersData).forEach((key) => {
            try {
              const peer = peersData[key];
              peer.peer.removeTrack(sender[key]);
            } catch (error) {
              console.log(error, key, sender[key]);
            }
          });
        }
      }
    }

    setIsCameraOn((prevCameraOn) => !prevCameraOn);
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
        }, 500);
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
      return peers;
    });
    setRemoteStream((prev) => ({ ...prev, [id]: null }));
    const videoDoc = document.getElementById(`meeting-user-video-${id}`);
    videoDoc.srcObject = null;
  };

  const handleParticipants = ({
    participantsId,
    participants: participantsData,
  }) => {
    console.log("participants", participantsData, participantsId);
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

  const handleCallUser = useCallback(
    async (to, selectedPeer) => {
      console.log("Calling...", to);
      if (selectedPeer) {
        console.log("selected peer", selectedPeer);
        const offer = await selectedPeer.generateOffer();
        socket.emit("user:call", { to, offer });
      } else if (peersData[to] !== undefined) {
        console.log("normal peer", peersData[to]);
        const peer = peersData[to];
        const offer = await peer.generateOffer();
        socket.emit("user:call", { to, offer });
      }
    },
    [peersData, setParticipantsArray]
  );

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
        const res = await peer.setRemoteDescription(ans);
        if (res === null && retryCallCount < 3) {
          handleCallUser(from, peer);
          setRetryCallCount((prev) => prev + 1);
        } else {
          console.log("Call Accepted!");
          sendStreams(from);
          setRetryCallCount(0);
        }
      } catch (err) {
        console.log(err);
      }
    },
    [peersData]
  );

  const sendStreams = useCallback(
    (to) => {
      if (!VideoStreamRef.current) return;
      let sender = null;
      console.log("Sending stream to", to);

      const peer = peersData[to];

      VideoStreamRef.current.getTracks().forEach((track) => {
        sender = peer.peer.addTrack(track, VideoStreamRef.current);
      });

      setSender((prev) => ({ ...prev, [to]: sender }));
    },
    [VideoStreamRef.current, peersData]
  );

  const handleNegoNeeded = useCallback(
    async (from) => {
      console.log("Nego needed", peersData[from]);
      const peer = peersData[from];
      const offer = await peer.generateOffer();
      socket.emit("peer:nego:needed", { offer, to: from });
    },
    [peersData]
  );

  const handleNegoNeedIncomming = useCallback(
    async ({ from, offer }) => {
      try {
        console.log(`Nego needed Incoming from ${from}`, peersData[from]);
        setRemoteStream((prev) => ({
          ...prev,
          [from]: null,
        }));
        const videoDoc = document.getElementById(`meeting-user-video-${from}`);
        videoDoc.srcObject = null;

        const peer = peersData[from];
        const ans = await peer.getAnswer(offer);
        socket.emit("peer:nego:done", { to: from, ans });
      } catch (err) {
        console.log(err);
      }
    },
    [peersData, socket]
  );

  const handleNegoNeedFinal = useCallback(
    async ({ from, ans }) => {
      console.log(`Nego needed final from ${from}`, peersData[from]);
      try {
        const peer = peersData[from];
        await peer.setRemoteDescription(ans);
      } catch (err) {
        console.log(err);
      }
    },
    [peersData, socket]
  );

  React.useEffect(() => {
    Object.keys(peersData).forEach((key) => {
      const peer = peersData[key];
      peer.peer.addEventListener("negotiationneeded", () => {
        ((key) => {
          handleNegoNeeded(key);
        })(key);
      });
      peer.peer.addEventListener("iceconnectionstatechange", (e) => {
        ((key) => {
          console.log("ice state changed", e);
          if (peer.peer.iceConnectionState === "disconnected") {
            console.log("Disconnected");
            peersData[key].peer.close();
            // setPeersData((prev) => {
            //   delete prev[key];
            //   return { ...prev };
            // });
          }
        })(key);
      });
    });

    return () => {
      Object.keys(peersData).forEach((key) => {
        const peer = peersData[key];
        peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
        peer.peer.removeEventListener("iceconnectionstatechange", () => {});
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
          setRemoteStream((prev) => ({
            ...prev,
            [key]: newRemoteStream[0],
          }));

          // set remote video ref
          const videoDoc = document.getElementById(`meeting-user-video-${key}`);
          videoDoc.srcObject = newRemoteStream[0];
          videoDoc.onloadedmetadata = () => {
            videoDoc.play();
          };
          videoDoc.autoPlay = true;
        })(key);
      });
    });
  }, [peersData]);

  const handleRemoteCameraToogle = ({ id, state }) => {
    console.log("remote camera toogle", id, state);
    // if (state === 'on') { }
    if (state === "off") {
      setRemoteStream((prev) => ({
        ...prev,
        [id]: null,
      }));
      const videoDoc = document.getElementById(`meeting-user-video-${id}`);
      if (videoDoc) videoDoc.srcObject = null;
    }
  };

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
    handleRemoteCameraToogle,
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

  console.log("My Socket Address: ", socket.id);
  console.log("peers data: ", peersData);
  console.log("remote streams: ", remoteStream);
  console.log("sender: ", sender);

  const toggleAddOns = () => {
    setIsAddOnsVisible(!isAddOnsVisible);
  };

  const handleRecordToggle = () => {
    setIsRecorded(!isRecorded);
  };

  const handleMicToggle = () => {
    setIsMicOn(!isMicOn);
  };
  const handleScreenShareToggle = () => {
    setIsScreenShareOn(!isScreenShareOn);
  };
  const toggleChatDrawer = () => {
    setIsChatOpen(!isChatOpen);
  };

  const togglePeopleDrawer = () => {
    setIsPeopleDrawerOpen(!isPeopleDrawerOpen);
  };

  return (
    <Box sx={style.joinMeetingContainerBox}>
      <Box sx={style.joinMeetingInnerBox}>
        {isAddOnsVisible && (
          <Box sx={style.addOnVisibleContainerBox(isAddOnsVisible)}>
            <Typography sx={{ fontWeight: 700, fontSize: 20, color: "white" }}>
              Coding Test
            </Typography>
            <ProfileEditTextField
              multiline
              rows={30}
              sx={style.addOnTextField}
            />
            <Button sx={style.btnStyle}>Submit</Button>
          </Box>
        )}
        <Box sx={style.videoCallContainerBox(isAddOnsVisible)}>
          {/* // My Video Stream */}
          <Box sx={style.videoCallInnerBox(isAddOnsVisible, 0)}>
            <Box
              sx={{
                width: "100%",
                height: "100%",
                position: "relative",
                borderRadius: "10px",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "10px",
                  objectFit: "cover",
                  position: "absolute",
                  top: 0,
                  left: 0,
                  zIndex: 10,
                }}
              />
              <Box sx={style.avatarProfileBox}>
                <Avatar
                  alt={userAuth.email}
                  src={userAuth.photoURL}
                  sx={style.avatarProfile}
                />
                <Typography sx={style.avatarTypo}>
                  {userAuth.displayName}
                </Typography>
              </Box>
            </Box>
          </Box>
          {participantsArray.map((participant, index) => (
            <Box
              key={participant.id}
              sx={style.videoCallInnerBox(isAddOnsVisible, index + 1)}
            >
              <Box
                sx={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  borderRadius: "10px",
                }}
              >
                <video
                  id={`meeting-user-video-${participant.id}`}
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "10px",
                    objectFit: "cover",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: 10,
                  }}
                />
                <Box sx={style.avatarProfileBox}>
                  <Avatar
                    alt={participant.email}
                    src={participant.photoURL}
                    sx={style.avatarProfile}
                  />
                  <Typography sx={style.avatarTypo}>
                    {participant.displayName}
                  </Typography>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* {footer icons} */}
      <Box sx={style.iconsContainerBox}>
        <Box sx={style.iconInnerBox}>
          <IconButton
            sx={style.isRecorded(isRecorded)}
            onClick={handleRecordToggle}
          >
            <RadioButtonChecked />
          </IconButton>
          <IconButton onClick={handleMicToggle} sx={style.isMicBtn(isMicOn)}>
            {isMicOn ? <Mic /> : <MicOff />}
          </IconButton>
          <IconButton
            onClick={handleCameraToggle}
            sx={style.isVideoCamBtn(isCameraOn)}
          >
            {isCameraOn ? <Videocam /> : <VideocamOff />}
          </IconButton>
          <IconButton
            onClick={handleScreenShareToggle}
            sx={style.isShareScreenBtn(isScreenShareOn)}
          >
            {isScreenShareOn ? <StopScreenShare /> : <ScreenShare />}
          </IconButton>
          <IconButton
            sx={style.callEndBtn}
            onClick={() => {
              setSteps(2);
            }}
          >
            <CallEnd />
          </IconButton>
          <IconButton sx={{ color: "white" }}>
            <MoreVert />
          </IconButton>
        </Box>
        <Box sx={style.chatMainBox}>
          <IconButton onClick={toggleAddOns} sx={{ color: "white" }}>
            <AddCardIcon />
          </IconButton>
          <IconButton sx={{ color: "white" }} onClick={togglePeopleDrawer}>
            <Badge badgeContent={participantsArray.length + 1} color="primary">
              <PeopleAltOutlinedIcon />
            </Badge>
          </IconButton>
          <IconButton onClick={toggleChatDrawer} sx={{ color: "white" }}>
            <Chat />
          </IconButton>
        </Box>
      </Box>

      {/* {People Modal} */}

      {/* Add your people modal implementation here */}
      {isPeopleDrawerOpen && (
        <PeopleDrawer
          participants={[
            ...participantsArray,
            {
              id: socket.id,
              displayName: userAuth.displayName,
              email: userAuth.email,
              photoURL: userAuth.photoURL,
            },
          ]}
          isPeopleDrawerOpen={isPeopleDrawerOpen}
          togglePeopleDrawer={togglePeopleDrawer}
        />
      )}

      {/* {chat Drawer} */}
      <ChatModal isChatOpen={isChatOpen} toggleChatDrawer={toggleChatDrawer} />
    </Box>
  );
};

JoinMeeting.propTypes = {
  setSteps: PropTypes.func.isRequired,
};

export default JoinMeeting;

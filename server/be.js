const emailToSocketIdDataMap = new Map();
const socketidToEmailMap = new Map();
const roomToParticipantsMap = new Map();

class SocketServer {
  constructor(io) {
    this.io = io;
    this.io.on("connect", (socket) => {
      console.log(`Socket Connected`, socket.id);

      // console.log(emailToSocketIdDataMap);
      // console.log(socketidToEmailMap);
      console.log(roomToParticipantsMap);

      socket.on("room:join", (data) => {
        const { email, displayName, photoURL, room } = data;
        console.log(email, room, "User Joined")
        emailToSocketIdDataMap.set(email, {
          id: socket.id,
          displayName,
          photoURL,
          email
        });

        io.to(room).emit("user:joined", { email, displayName, photoURL, id: socket.id })

        socket.join(room);
        socketidToEmailMap.set(socket.id, email);

        if (!roomToParticipantsMap.has(room)) {
          roomToParticipantsMap.set(room, new Set());
        }
        if (roomToParticipantsMap.get(room).has(socket.id)) {
          console.log("User already exists in the room");
          return;
        }

        roomToParticipantsMap.get(room).add(socket.id);
        io.to(room).emit("user:update", {
          email,
          participantsId: Array.from(roomToParticipantsMap.get(room)),
          participants: Array.from(roomToParticipantsMap.get(room)).filter(obj => Boolean(obj)).map(
            (id) => emailToSocketIdDataMap.get(socketidToEmailMap.get(id))
          )
        });
        // io.to(socket.id).emit("room:join", data);
      });

      socket.on("user:call", ({ to, offer }) => {
        io.to(to).emit("incomming:call", { from: socket.id, offer });
      });

      socket.on("call:accepted", ({ to, ans }) => {
        io.to(to).emit("call:accepted", { from: socket.id, ans });
      });

      socket.on("peer:nego:needed", ({ to, offer }) => {
        // console.log("peer:nego:needed", offer);
        io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
      });

      socket.on("peer:nego:done", ({ to, ans }) => {
        // console.log("peer:nego:done", ans);
        io.to(to).emit("peer:nego:final", { from: socket.id, ans });
      });

      socket.on("user:camera:toogle", ({ id, state, room }) => {
        io.to(room).emit("user:camera:toogle", { id, state })
      })

      socket.on("room:leave", ({ room }) => {
        const email = socketidToEmailMap.get(socket.id);
        console.log("Socket Disconnected", socket.id, email);
        emailToSocketIdDataMap.delete(email);
        socketidToEmailMap.delete(socket.id);
        roomToParticipantsMap.get(room).delete(socket.id);
        if (roomToParticipantsMap.get(room).size === 0) {
          roomToParticipantsMap.delete(room);
        }
        io.to(room).emit("user:leave", { email, id: socket.id });
        socket.leave(room);
      });
    })
    this.io.on("error", (error) => {
      console.log("Socket Error", error);
    });
  }

  emit(eventName, data) {
    this.io.sockets.emit(eventName, data);
  }
}

module.exports = SocketServer;

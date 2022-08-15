mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let peerConnection2  = null
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let roomRef= null;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();
  roomRef = await db.collection('rooms').doc();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners(peerConnection);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
    console.log('Add a track to pc:', track);
  });

  // Code for collecting ICE candidates below
  const callerCandidatesCollection = roomRef.collection('callerCandidates');

  peerConnection.addEventListener('icecandidate', event => {
    if (!event.candidate) {
      console.log('Got final candidate!');
      return;
    }
    console.log('Got candidate: ', event.candidate);
    callerCandidatesCollection.add(event.candidate.toJSON());
  });
  // Code for collecting ICE candidates above

  // Code for creating a room below
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('Created offer:', offer);

  const roomWithOffer = {
    'offer': {
      type: offer.type,
      sdp: offer.sdp,
    },
  };
  await roomRef.set(roomWithOffer);
  roomId = roomRef.id;
  console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
  document.querySelector(
      '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
  // Code for creating a room above

  peerConnection.addEventListener('track', event => {
    console.log('Got remote track:', event.streams[0]);
    event.streams[0].getTracks().forEach(track => {
      console.log('Add a track to the remoteStream:', track);
      remoteStream.addTrack(track);
    });

  });

  const unsub1 = roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
      
      
    }
    });


 const unsub2 = roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
    
      }
    });
  });

   
  // Listening for remote session description below
   peerConnection.addEventListener('connectionstatechange', async event => {
   if (peerConnection.connectionState === 'connected'){ 
    await delay(10); 
    unsub1();
    unsub2();
    await openSecondUserMedia();
    await restartpc();
      }});
  // Listening for remote session description above

      
    
  

}

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').
      addEventListener('click', async () => {
        roomId = document.querySelector('#room-id').value;
        console.log('Join room: ', roomId);
        document.querySelector(
            '#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
        await joinRoomById(roomId);


      }, {once: true});
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  let roomSnapshot = await roomRef.get();
  console.log('Got room:', roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners(peerConnection);
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Code for collecting ICE candidates below
    const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      calleeCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
    });

    // Code for creating SDP answer below
    const offer = roomSnapshot.data().offer;
    console.log('Got offer:', offer);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    console.log('Created answer:', answer);
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);
    // Code for creating SDP answer above

    // Listening for remote ICE candidates below
    roomRef.collection('callerCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
          
        }
        
        
      });
    });

  }
    // Listening for remote ICE candidates above
    // second pc
   /*const tracks = document.querySelector('#remoteVideo').srcObject.getTracks();
   tracks.forEach(track => {
    track.stop();
   });*/

   peerConnection.addEventListener('connectionstatechange', async event => {
    if (peerConnection.connectionState === 'disconnected'){
    peerConnection.close();
    console.log('current pc disconnected');
    remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = remoteStream;
  
     roomSnapshot = await roomRef.get();
     console.log('Got room:', roomSnapshot.exists);
  
    if (roomSnapshot.exists) {
      console.log('Create PeerConnection with configuration: ', configuration);
  
      peerConnection = new RTCPeerConnection(configuration);
      registerPeerConnectionListeners(peerConnection);
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
  
      // Code for collecting ICE candidates below
      const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
      peerConnection.addEventListener('icecandidate', event => {
        if (!event.candidate) {
          console.log('Got final candidate!');
          return;
        }
        console.log('Got candidate: ', event.candidate);
        calleeCandidatesCollection.add(event.candidate.toJSON());
      });
      // Code for collecting ICE candidates above
  
      peerConnection.addEventListener('track', event => {
        console.log('Got remote track:', event.streams[0]);
        event.streams[0].getTracks().forEach(track => {
          console.log('Add a track to the remoteStream:', track);
          remoteStream.addTrack(track);
        });
      });
  
      // Code for creating SDP answer below
      const offer = roomSnapshot.data().offer;
      console.log('Got offer:', offer);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      console.log('Created answer:', answer);
      await peerConnection.setLocalDescription(answer);
  
      const roomWithAnswer = {
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
      };
      await roomRef.update(roomWithAnswer);
      // Code for creating SDP answer above
  
      // Listening for remote ICE candidates below
      roomRef.collection('callerCandidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          if (change.type === 'added') {
            let data = change.doc.data();
            console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
            await peerConnection.addIceCandidate(new RTCIceCandidate(data));
            
          }
          
          
        });
      });
 

    }
  }
  });
  
  
  

  
    // Code for creating SDP answer above
  
}

async function openUserMedia(e) {
  const stream1 = await navigator.mediaDevices.getUserMedia(
      {audio: true, video: {width: {exact: 1080}, height: {exact: 720}}}
      );
  document.querySelector('#localVideo').srcObject = stream1;
  localStream = stream1;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;

  console.log('Stream:', document.querySelector('#localVideo').srcObject);
  document.querySelector('#cameraBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = false;
  document.querySelector('#createBtn').disabled = false;
  document.querySelector('#hangupBtn').disabled = false;
}

async function hangUp(e) {
  const tracks = document.querySelector('#localVideo').srcObject.getTracks();
  tracks.forEach(track => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
     roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners(pC) {
  pC.addEventListener('icegatheringstatechange', () => {
    console.log(
        `ICE gathering state changed: ${pC.iceGatheringState}`);
  });

  pC.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${pC.connectionState}`);
  });

  pC.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${pC.signalingState}`);
  });

  pC.addEventListener('iceconnectionstatechange ', () => {
    console.log(
        `ICE connection state change: ${pC.iceConnectionState}`);
  });
}

async function openSecondUserMedia(e) {
  localStream.getTracks().forEach(track => {
    track.stop();
   });

  const stream2 = await navigator.mediaDevices.getUserMedia(
        {audio: true, video: {width: {exact: 160}, height: {exact: 120}}}
        );
  document.querySelector('#localVideo').srcObject = stream2;
  localStream = stream2;
  remoteStream = new MediaStream();
  document.querySelector('#remoteVideo').srcObject = remoteStream;
  console.log('Stream:', document.querySelector('#localVideo').srcObject);
}

function delay(n){
  return new Promise((resolve) => {
    setTimeout(resolve, n * 1000);
  });
}

init();
 
async function restartpc(){

    const db = firebase.firestore();
     roomRef = db.collection('rooms').doc(roomId);

  if (peerConnection) {
    peerConnection.close();
  }
 
  if (roomId) {
    
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    //await roomRef.delete();
    var removeoffer = roomRef.update(
      {offer: firebase.firestore.FieldValue.delete()}
  );
  var removeanswer = roomRef.update(
    {answer: firebase.firestore.FieldValue.delete()}
);
  }

   
  
    console.log('Create PeerConnection with configuration: ', configuration);
    peerConnection = new RTCPeerConnection(configuration);
  
    registerPeerConnectionListeners(peerConnection);
  
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
      console.log('Add a track to pc:', track);
    });
  
    // Code for collecting ICE candidates below
    const callerCandidatesCollection = roomRef.collection('callerCandidates');
  
    peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      callerCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above
  
    // Code for creating a room below
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('Created offer:', offer);
  
    const roomWithOffer = {
      'offer': {
        type: offer.type,
        sdp: offer.sdp,
      },
    };
    await roomRef.set(roomWithOffer);
    roomId = roomRef.id;
    console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
    document.querySelector(
        '#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
    // Code for creating a room above
  
    peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        remoteStream.addTrack(track);
      });
  
    });
  
    // Listening for remote session description below
    roomRef.onSnapshot(async (snapshot) => {
      const data = snapshot.data();
      if (!peerConnection.currentRemoteDescription && data && data.answer) {
        console.log('Got remote description: ', data.answer);
        const rtcSessionDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(rtcSessionDescription);
  
      }
  
      });
      
   
    // Listening for remote session description above
  
    // Listen for remote ICE candidates below
    roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      
        }
      });
    });
    // Listen for remote ICE candidates above
}
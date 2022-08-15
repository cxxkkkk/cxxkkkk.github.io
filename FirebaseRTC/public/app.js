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


let bandwidthSelector = document.querySelector('select#bandwidth');


function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  document.querySelector('#resolutionBtn').addEventListener('click', rslReduce);
  document.querySelector('#framerateBtn').addEventListener('click', frRuduce);
  document.querySelector('#restoreBtn').addEventListener('click', restore);
  bandwidthSelector.addEventListener('change', askBandwidthChange);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

  remoteVideo.addEventListener('loadedmetadata', function() {
    document.querySelector(
      '#setup').innerText =`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`;
      })

  remoteVideo.addEventListener('resize', () => {
        document.querySelector(
      '#setup').innerText =`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`;
  });

  const codecPreferences = document.getElementById('codecPreferences');
  const supportsSetCodecPreferences = window.RTCRtpTransceiver && 'setCodecPreferences' in window.RTCRtpTransceiver.prototype;

  if (supportsSetCodecPreferences) {
    const {codecs} = RTCRtpSender.getCapabilities('video');
    codecs.forEach(codec => {
      if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) {
        return;
      }
      const option = document.createElement('option');
      option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
      option.innerText = option.value;
      codecPreferences.appendChild(option);
    });
    codecPreferences.disabled = false;
  }

}


async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  
  
  const codecPreferences = document.getElementById('codecPreferences');
  const supportsSetCodecPreferences = window.RTCRtpTransceiver && 'setCodecPreferences' in window.RTCRtpTransceiver.prototype;
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
 
  if (supportsSetCodecPreferences) {
    const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== '') {
      const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
      const {codecs} = RTCRtpSender.getCapabilities('video');
      const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      console.log(codecs);
      const transceiver = peerConnection.getTransceivers().find(t => t.sender && t.sender.track === localStream.getVideoTracks()[0]);
      transceiver.setCodecPreferences(codecs);
      console.log('Preferred video codec', selectedCodec);
    }
  }
  codecPreferences.disabled = true;


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
  const unsub1 = roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data && data.answer) {
      console.log('Got remote description: ', data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
    });
  
  
  // Listening for remote session description above

  // Listen for remote ICE candidates below
  const unsub2 = roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type === 'added') {
        let data = change.doc.data();
        console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
    
      }
    });
  });
  // Listen for remote ICE candidates above


  peerConnection.addEventListener('connectionstatechange', async event => {
    if (peerConnection.connectionState === 'connected'){ 
        setTimeout(async () => {
          const stats = await peerConnection.getStats();
          stats.forEach(stat => {
            if (!(stat.type === 'outbound-rtp' && stat.kind === 'video')) {
              return;
            }
            const codec = stats.get(stat.codecId);
            document.getElementById('actualCodec').innerText = 'Using ' + codec.mimeType +
                (codec.sdpFmtpLine ? ' ' + codec.sdpFmtpLine + ' ' : '') +
                ', payloadType=' + codec.payloadType + '. Encoder: ' + stat.encoderImplementation;
          });
        }, 1000);
      

     await delay(5); 

     unsub1();
     unsub2();
     
    
    const unsub3 = roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if ( data.constraint) {
      console.log('Got constraint: ', data.constraint);
      await openSecondUserMedia(data.constraint);
      var removecon = roomRef.update(
        {constraint: firebase.firestore.FieldValue.delete()}
       );
    }

    if ( data.bandwidthParams) {
      console.log('Got bandwidth: ', data.bandwidthParams.bandwidth);
      bandwidthchange(data.bandwidthParams.bandwidth);
      var removebw= roomRef.update(
        {bandwidthParams: firebase.firestore.FieldValue.delete()}
       );
    }
    });
   
  }

 });
};

function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#resolutionBtn').disabled = false;
  document.querySelector('#framerateBtn').disabled = false;
  document.querySelector('#restoreBtn').disabled = false;
  document.querySelector('select#bandwidth').disabled = false;
  document.getElementById('codecPreferences').disabled = true;

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
  const roomSnapshot = await roomRef.get();
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

   
    // Listening for remote ICE candidates above
  }
    // Code for creating SDP answer above

  
 } 

async function openUserMedia(e) {
  const stream1 = await navigator.mediaDevices.getUserMedia(
      {audio: true, video: true}
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
  document.querySelector('#setup').innerText = ''
  document.querySelector('#resolutionBtn').disabled = true;
  document.querySelector('#framerateBtn').disabled = true;
  document.querySelector('#restoreBtn').disabled = true;


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
    //await roomRef.delete();
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

function openSecondUserMedia(con) {

  navigator.mediaDevices.getUserMedia(
      {audio: true, 
        video: con,
      })
  .then(function(stream) {
    localStream = stream;
    console.log('stream:',stream);
    let videoTrack = stream.getVideoTracks()[0];
 
    let sender = peerConnection.getSenders().find(function (s) {
        return s.track.kind == videoTrack.kind;
      });
      console.log('found sender:', sender);
      sender.replaceTrack(videoTrack);
  
  })
  .catch(function(err) {
    console.error('Error happens:', err);
  })
}

function delay(n){
  return new Promise((resolve) => {
    setTimeout(resolve, n * 1000);
  });
}

init();

async function rslReduce(){
  document.querySelector('#resolutionBtn').disabled = true;
  document.querySelector('#framerateBtn').disabled = false;
  document.querySelector('#restoreBtn').disabled = false;

  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const constraint = {
    constraint: {
      width: 160,
      height: 120,
    },
  };
  await roomRef.update(constraint);
}

async function frRuduce(){
  document.querySelector('#resolutionBtn').disabled = false;
  document.querySelector('#framerateBtn').disabled = true;
  document.querySelector('#restoreBtn').disabled = false;


  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const constraint = {
    constraint: {
      frameRate: 10,
    },
  };
  await roomRef.update(constraint);
}

async function restore(){
  document.querySelector('#resolutionBtn').disabled = false;
  document.querySelector('#framerateBtn').disabled = false;
  document.querySelector('#restoreBtn').disabled = true;

  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  const constraint = {
    constraint: true,
  };
  await roomRef.update(constraint);
 
}

function bandwidthchange(bandwidth){
  
  bandwidthSelector.disabled = true;
  

  const sender = peerConnection.getSenders()[1];
  const parameters = sender.getParameters();

  if (bandwidth === 'unlimited') {
    delete parameters.encodings[0].maxBitrate;
  } else {
    parameters.encodings[0].maxBitrate = bandwidth * 1000;
  }

  sender.setParameters(parameters)
      .then(() => {
        bandwidthSelector.disabled = false;
        console.log('maxBitrate change:',parameters.encodings[0].maxBitrate)
      })
      .catch(e => console.error(e));

}
async function askBandwidthChange(){

  const bandwidth = bandwidthSelector.options[bandwidthSelector.selectedIndex].value;

  const db = firebase.firestore();
  roomRef = db.collection('rooms').doc(`${roomId}`);
  
  bandwidthParam = {
    bandwidthParams:
    {
    exists:true,
    bandwidth: bandwidth,
  }
}
  await roomRef.update(bandwidthParam);
}
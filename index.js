//File-Portal-RTC © Albert Bregonia 2021

//HTML elements
const loginDialog = document.getElementById(`login-dialog`),
      remoteDialog = document.getElementById(`remote-dialog`),
      remoteInput = document.getElementById(`remote-input`),
      iceDialog = document.getElementById(`ice-dialog`),
      iceInput = document.getElementById(`ice-input`),
      copyICE = document.getElementById(`copy-ice`),
      transferDialog = document.getElementById(`transfer-dialog`),
      fileSelector = document.getElementById(`file-selector`);

//WebRTC connection
const chunkSize = 256*1024, //256kb per message (WebRTC says this isn't possible but anything higher than this throws an error)
      transferChannelCount = 512 - 1, //-1 for metadata channel, the theoretical maximum is 65535 bc of ports but chrome limits me to 512 channels
      currentTransfer = { //information about the current file transfer
        timeStart: 0,
        counter: 0,
        filename: undefined,
        buffer: undefined,
      }, iceCandidates = [],

rtc = new RTCPeerConnection({iceServers: [{urls: `stun:stun.l.google.com:19302`}]}); //create a WebRTC instance
rtc.onicecandidate = ({candidate}) => candidate && iceCandidates.push(candidate); //if the ice candidate is not null, send it to the peer
rtc.oniceconnectionstatechange = () => {
    switch(rtc.iceConnectionState) {
        case `failed`:
            alert(`Connection failed. Retrying...`);
            rtc.restartIce(); 
            break;
        case `disconnected`:
            alert(`Disconnected`);
            break;
        case `connected`:
            alert(`Connection Established`);
            hideElements(iceDialog, copyICE);
            break;
    }
};
rtc.ondatachannel = ({channel}) => {
    if(channel.label == `metadata`) {
        rtc.metadataChannel = channel;
        rtc.metadataChannel.onmessage = ({data}) => {
            const signal = JSON.parse(data);
            if(signal.event == `start`) {
                currentTransfer.timeStart = new Date();
                currentTransfer.counter = 0;
                currentTransfer.buffer = new Array(signal.bufferSize);
                currentTransfer.filename = signal.filename;
                alert(`Receiving: ${signal.filename}`);
            }
        };
    } else {
        channel.onmessage = ({data}) => {
            let index = parseInt(channel.label), 
                end = currentTransfer.buffer.length - 1;
            while(currentTransfer.buffer[index])
                if((index += transferChannelCount) > end)
                    index = end;
            currentTransfer.buffer[index] = data;
            currentTransfer.counter++;
            if(currentTransfer.counter == end+1) {
                console.log(`Elapsed: ${(new Date() - currentTransfer.timeStart)/1000.0} seconds`);
                const link = document.createElement(`a`);
                hideElements(link);
                link.href = URL.createObjectURL(new Blob(currentTransfer.buffer));
                link.download = currentTransfer.filename;
                link.click();
                currentTransfer.timeStart = 
                    currentTransfer.counter = 0;
                currentTransfer.buffer = 
                    currentTransfer.filename = undefined;
            }
        };
    }
    console.log(`Channel initialized!`);
};

function hideElements(...elements) {
    for(const element of elements)
        element.style.display = `none`;
}

async function rtcSetup(sending) {
    //event handlers
    remoteDialog.onsubmit = () => {
        (async () => {
            await rtc.setRemoteDescription(JSON.parse(atob(remoteInput.value)));
            if(!sending) {
                const answer = await rtc.createAnswer();
                await rtc.setLocalDescription(answer);
                await navigator.clipboard.writeText(btoa(JSON.stringify(answer)));
                alert(`Successfully saved remote ID. Local ID has been copied to your clipboard. Please send this to your peer.`);
            } else {
                alert(`Successfully saved remote ID. Please copy your local connection info and send it to your peer.`);
            }
            hideElements(remoteDialog);
        })();
        return false;
    };
    iceDialog.onsubmit = () => {
        (async () => {
            for(const ice of JSON.parse(atob(iceInput.value)))
                rtc.addIceCandidate(ice);
            alert(`Successfully saved remote connection info.`);
        })();
        return false;
    };
    copyICE.onclick = async () => {
        await navigator.clipboard.writeText(btoa(JSON.stringify(iceCandidates)));
        alert(`Local connection info has been copied to your clipboard. Please send this to your peer.`);
    };
    transferDialog.onsubmit = () => {
        if(fileSelector.files.length != 1 || currentTransfer.buffer) {
            alert(`Only 1 file is allowed to be sent at a time!`);
            return;
        }
        const file = fileSelector.files[0],
              reader = new FileReader();
        if(!confirm(`Confirm sending: ${file.name}`)) {
            alert(`Transfer cancelled`);
            return;
        }
        reader.onload = ({target}) => {
            const fileContent = target.result;
            rtc.metadataChannel.send(JSON.stringify({ //send info about the file to be transferred for initialization
                event: `start`,
                bufferSize: Math.ceil(1.0*fileContent.byteLength/chunkSize),
                filename: file.name,
            }));
            for(let chunk=0, i=0; chunk<fileContent.byteLength; i++) 
                rtc.transferChannels[i%transferChannelCount] //evenly distribute the chunks of binary data in order to prevent overloading the buffers
                    .send(fileContent.slice(chunk, (chunk+=chunkSize)));
        };
        reader.readAsArrayBuffer(file);
        return false;
    };
    //selection specific setup
    hideElements(loginDialog);
    if(sending) { //create metadata and file transfer channels
        const channelErrorHandler = ({error}) => console.error(error);
        rtc.metadataChannel = rtc.createDataChannel(`metadata`);
        rtc.metadataChannel.onerror = channelErrorHandler;
        rtc.transferChannels = new Array(transferChannelCount);
        for(let i=0; i<transferChannelCount; i++) { //`channelCount` channels are created in order to spread out the data and not overload the buffer
            rtc.transferChannels[i] = rtc.createDataChannel(i);
            rtc.transferChannels[i].onerror = channelErrorHandler;
        }
        const offer = await rtc.createOffer();
        await rtc.setLocalDescription(offer);
        await navigator.clipboard.writeText(btoa(JSON.stringify(offer)));
        alert(`Local ID has been copied to your clipboard. Please send this to your peer`);
    } else {
        alert(`Waiting for remote ID...`);
    }
}
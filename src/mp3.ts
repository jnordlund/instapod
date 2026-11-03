interface Frame {
    length: number;
    samples: number;
    sampleRate: number;
    metadataOffset: number;
}

function readFrame(audio: Buffer, offset: number): Frame {
    if (offset + 4 > audio.length) throw new Error("TTS provider returned a truncated MP3");
    const header = audio.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleIndex = (header >>> 10) & 3;
    if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
        throw new Error("TTS provider did not return valid MP3 audio");
    }
    const bitrates = version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sampleRate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const length = Math.floor((version === 3 ? 144 : 72) * bitrates[bitrateIndex] * 1000 / sampleRate) + ((header >>> 9) & 1);
    if (offset + length > audio.length) throw new Error("TTS provider returned a truncated MP3");
    const mono = ((header >>> 6) & 3) === 3;
    const sideInfoLength = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const crcLength = ((header >>> 16) & 1) ? 0 : 2;
    return { length, sampleRate, samples: version === 3 ? 1152 : 576, metadataOffset: offset + 4 + crcLength + sideInfoLength };
}

/** Strip per-file metadata before joining independently encoded MP3 chunks. */
export function mp3AudioFrames(audio: Buffer): Buffer {
    let start = 0;
    while (audio.subarray(start, start + 3).toString() === "ID3") {
        if (start + 10 > audio.length) throw new Error("TTS provider returned a truncated MP3 tag");
        const size = ((audio[start + 6] & 127) << 21) | ((audio[start + 7] & 127) << 14) | ((audio[start + 8] & 127) << 7) | (audio[start + 9] & 127);
        start += 10 + size + ((audio[start + 5] & 16) ? 10 : 0);
    }
    let end = audio.length;
    if (end >= 128 && audio.subarray(end - 128, end - 125).toString() === "TAG") end -= 128;
    const frame = readFrame(audio.subarray(0, end), start);
    const marker = audio.subarray(frame.metadataOffset, frame.metadataOffset + 4).toString();
    // Xing/Info describes only this chunk's duration, not the complete episode.
    if (marker === "Xing" || marker === "Info") start += frame.length;
    return audio.subarray(start, end);
}

/** Read actual MPEG Layer III frame durations, including variable bitrate audio. */
export function mp3Duration(audio: Buffer): number {
    const frames = mp3AudioFrames(audio);
    let offset = 0;
    let seconds = 0;
    let count = 0;
    while (offset < frames.length) {
        const frame = readFrame(frames, offset);
        seconds += frame.samples / frame.sampleRate;
        count++;
        offset += frame.length;
    }
    if (count < 2) throw new Error("TTS provider did not return valid MP3 audio");
    return seconds;
}

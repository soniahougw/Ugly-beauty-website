// Narrated tour: one voice clip per place, played when the camera flies there.
// Clips live in audio/tour/<id>.mp3 (generated with ElevenLabs text to speech).
// Until a clip exists, its script still shows as a caption, so the tour works silently.

export const NARRATION = {
  intro:
    'Welcome to Theodore Roosevelt Island, a memorial you can walk through. Instead of a grand building, the nation honored its conservation president with a whole island of forest in the Potomac River. Let’s take a short tour.',
  footbridge:
    'Every visit begins here. There are no cars on the island, so everyone crosses this footbridge from the Virginia shore. Leave the busy parkway behind, and step into the woods.',
  memorial:
    'In this clearing stands Paul Manship’s seventeen-foot bronze statue of Theodore Roosevelt, his arm raised as if in mid-speech. Around him, four granite tablets carry his words on nature, manhood, youth, and the state. The memorial was dedicated in 1967, on his birthday.',
  upland:
    'Most of this island is forest. In the 1930s, following a plan by the Olmsted Brothers, Civilian Conservation Corps crews helped turn old fields into woods. Near the island’s southern end, you can still find traces of the Mason family estate, including a well and an icehouse; the family’s mansion was finished in 1802.',
  swamp:
    'Along the eastern edge, the Swamp Trail’s boardwalk crosses tidal marsh, where the river rises and falls each day. Walk quietly, and you may spot a great blue heron, a turtle sunning on a log, or a kingfisher diving for fish.',
  trbridge:
    'To the south, the Theodore Roosevelt Bridge carries traffic between Virginia and Washington. It opened in 1964, and passes right over the island’s southern tip.',
  kennedy:
    'Just downstream on the DC shore is the Kennedy Center, the nation’s performing arts center, which opened in 1971. Beside it are the curving walls of the Watergate complex.',
  monument:
    'Far to the southeast, past the Lincoln Memorial and the Reflecting Pool, the Washington Monument rises over the National Mall. From this quiet island, you can still see the heart of the capital.',
  georgetown:
    'Across the river is Georgetown, one of Washington’s oldest neighborhoods, with its brick rowhouses and the spire of Georgetown University’s Healy Hall. On many mornings, rowing crews glide past the island.',
  key:
    'Upstream is the Key Bridge, opened in 1923 and named for Francis Scott Key, who wrote the words of the Star-Spangled Banner. Its concrete arches link Rosslyn, in Virginia, with Georgetown.',
  rosslyn:
    'On the Virginia side, Rosslyn’s towers rise above the trees. A 1910 law limits building heights in Washington, so the tallest buildings you can see from here are across the river. That’s the end of our tour. Thanks for visiting!',
};
const TOUR = ['intro', 'footbridge', 'memorial', 'upland', 'swamp', 'trbridge', 'kennedy', 'monument', 'georgetown', 'key', 'rosslyn'];

const btnVoice = document.getElementById('btn-voice');
const btnTour = document.getElementById('btn-tour');
const caption = document.getElementById('caption');
const audio = new Audio();
audio.preload = 'none';

let voiceOn = false;
let touring = false;
let step = -1;
let token = 0; // invalidates callbacks from an older clip
let waitTimer = 0;

function setVoice(on) {
  voiceOn = on;
  btnVoice.setAttribute('aria-pressed', String(on));
  btnVoice.textContent = on ? '🔊 Narration' : '🔈 Narration';
  if (!on && !touring) stopClip();
}
function setTouring(on) {
  touring = on;
  btnTour.setAttribute('aria-pressed', String(on));
  btnTour.textContent = on ? '■ Stop tour' : '▶ Tour';
  if (!on) {
    clearTimeout(waitTimer);
    step = -1;
  }
}

function stopClip() {
  token++;
  audio.pause();
  caption.hidden = true;
}

// Plays a clip with its caption; calls done() when finished (or after reading time if the clip is missing).
function playClip(id, done) {
  const text = NARRATION[id];
  if (!text) return;
  const my = ++token;
  clearTimeout(waitTimer);
  caption.textContent = text;
  caption.hidden = false;
  let finished = false;
  const finish = () => {
    if (finished || my !== token) return;
    finished = true;
    caption.hidden = true;
    done?.();
  };
  const silent = () => {
    if (my !== token) return;
    caption.dataset.silent = 'true';
    waitTimer = setTimeout(finish, Math.max(4000, text.split(' ').length * 380));
  };
  delete caption.dataset.silent;
  audio.onended = finish;
  audio.onerror = silent;
  audio.src = `audio/tour/${id}.mp3`;
  audio.play().catch((err) => {
    if (err.name !== 'AbortError') silent();
  });
}

function next() {
  if (!touring) return;
  step++;
  if (step >= TOUR.length) {
    setTouring(false);
    return;
  }
  const id = TOUR[step];
  if (id === 'intro') {
    window.tri.goHome();
    playClip(id, () => (waitTimer = setTimeout(next, 800)));
  } else {
    window.tri.focusLandmark(id); // the landmark:focus handler below plays the clip
  }
}

window.addEventListener('landmark:focus', (e) => {
  const id = e.detail.id;
  if (touring && TOUR[step] !== id) setTouring(false); // visitor picked another place: leave the tour
  if (touring) playClip(id, () => (waitTimer = setTimeout(next, 1200)));
  else if (voiceOn) playClip(id);
});
window.addEventListener('landmark:close', () => {
  setTouring(false);
  stopClip();
});

btnVoice.addEventListener('click', () => setVoice(!voiceOn));
btnTour.addEventListener('click', () => {
  if (touring) {
    setTouring(false);
    stopClip();
    return;
  }
  setVoice(true);
  setTouring(true);
  next();
});

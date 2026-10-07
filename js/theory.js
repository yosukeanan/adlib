// Music theory: pitch classes, chord qualities and note classification.
const NOTE = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const PC = {C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const TUNING = [40,45,50,55,59,64];                 // low E → high E (MIDI)
const STRING_NAMES = ['E','A','D','G','B','e'];

// ct: chord tones, ten: tensions, av: avoid notes, guide: 3rd/7th, voice: comping voicing (semitones above root)
const CHORDS = {
  maj7: {sym:'maj7', ja:'maj7', ct:[0,4,7,11], ten:[2,6,9],       av:[5],     guide:[4,11], voice:[4,7,11,14],  avName:'11th（4度）'},
  '6':  {sym:'6',    ja:'6', ct:[0,4,7,9],  ten:[2,6],         av:[5],     guide:[4,9],  voice:[4,7,9,14],   avName:'11th（4度）'},
  m7:   {sym:'m7',   ja:'m7', ct:[0,3,7,10], ten:[2,5,9],       av:[],      guide:[3,10], voice:[3,7,10,14],  avName:''},
  m6:   {sym:'m6',   ja:'m6', ct:[0,3,7,9],  ten:[2,5,11],      av:[],      guide:[3,9],  voice:[3,7,9,14],   avName:''},
  '7':  {sym:'7',    ja:'7（ドミナント）', ct:[0,4,7,10], ten:[1,2,3,6,8,9], av:[5],     guide:[4,10], voice:[4,10,14,21], avName:'11th（4度）'},
  '7alt':{sym:'7alt', ja:'7alt',ct:[0,4,10],   ten:[1,3,6,8],     av:[2,5,9], guide:[4,10], voice:[4,10,13,20], avName:'ナチュラル9・11・13'},
  m7b5: {sym:'m7♭5', ja:'m7♭5', ct:[0,3,6,10], ten:[2,5,8],       av:[1],     guide:[3,10], voice:[3,6,10,12],  avName:'♭9'},
  dim7: {sym:'dim7', ja:'dim7', ct:[0,3,6,9],  ten:[2,5,8,11],    av:[],      guide:[3,9],  voice:[0,3,6,9],    avName:''}
};
const IV_LABEL = ['R','♭9','9','♭3','3','11','♯11','5','♭13','13','♭7','7'];
const CLASS_JA = {chord:'コードトーン', tension:'テンション', avoid:'アヴォイド', other:'経過音・アウト'};

const interval = (pc, root) => ((pc - root) % 12 + 12) % 12;
function ivLabel(q, iv) {
  if ((q === '7' || q === '7alt') && iv === 3) return '♯9';
  if ((q === 'm7b5' || q === 'dim7' || q === '7alt') && iv === 6) return '♭5';
  if ((q === '6' || q === 'm6') && iv === 9) return '6';
  if (q === 'dim7' && iv === 9) return '°7';
  return IV_LABEL[iv];
}
function classify(q, iv) {
  const c = CHORDS[q];
  if (c.ct.includes(iv)) return 'chord';
  if (c.ten.includes(iv)) return 'tension';
  if (c.av.includes(iv)) return 'avoid';
  return 'other';
}
const chordName = c => NOTE[c.pc] + CHORDS[c.q].sym;

export {NOTE, PC, TUNING, STRING_NAMES, CHORDS, IV_LABEL, CLASS_JA, interval, ivLabel, classify, chordName};

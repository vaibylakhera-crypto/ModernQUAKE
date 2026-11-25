// Team colours. Team 0 = no team (free-for-all), 1 = RED, 2 = BLUE.
export interface TeamStyle { name: string; css: string; hex: number; armor: number; suit: [number, number, number] }
export const TEAMS: Record<number, TeamStyle> = {
  1: { name: 'RED', css: '#ff5040', hex: 0xff4a3a, armor: 0xb8322a, suit: [0.45, 0.07, 0.06] },
  2: { name: 'BLUE', css: '#4a9aff', hex: 0x3a8aff, armor: 0x2a58c8, suit: [0.05, 0.13, 0.52] },
};
export type Mode = 'ffa' | 'tdm' | 'ctf' | 'insta' | 'lms' | 'koth';
/** only these have two sides */
export const isTeamMode = (m: string) => m === 'tdm' || m === 'ctf';
/** Last Man Standing: lives each, and King of the Hill: hold-time points per frag-limit step */
export const LIVES = 3, KOTH_PER_STEP = 4;
export const MODES: { id: Mode; name: string; short: string; desc: string }[] = [
  { id: 'ffa', name: 'DEATHMATCH', short: 'DM', desc: 'Everyone for themselves. Most frags wins.' },
  { id: 'tdm', name: 'TEAM DEATHMATCH', short: 'TDM', desc: 'Red vs Blue. Team frags win. No friendly fire.' },
  { id: 'ctf', name: 'CAPTURE THE FLAG', short: 'CTF', desc: 'Steal the enemy flag and bring it home.' },
  { id: 'insta', name: 'INSTAGIB', short: 'INSTA', desc: 'Everyone has a rail. One hit kills. No pickups.' },
  { id: 'lms', name: 'LAST MAN STANDING', short: 'LMS', desc: '3 lives each. No respawn after that. Last one alive wins.' },
  { id: 'koth', name: 'KING OF THE HILL', short: 'KOTH', desc: 'Hold the glowing zone alone to score. Kills do not count.' },
];
export const modeName = (m: string) => MODES.find(x => x.id === m)?.name ?? 'DEATHMATCH';

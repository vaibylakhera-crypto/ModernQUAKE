# ModernQUAKE: Game Design Doc (v0.2 draft)

## 1. Pitch
**Quake III Arena, but better.** A high-speed competitive arena FPS in the browser: skill-based multiplayer deathmatch built on momentum movement, item control, precise aim and map knowledge. Modern visuals, deeper movement, more dynamic maps, and polish.

Fully original: no Quake characters, weapons, maps, names, logos, textures, sounds or layouts. We take the *principles* of classic arena shooters and nothing else.

Reference feel: Q3A railgun and Quad Damage frag chains (see the reference video noted in section 13).

## 2. Pillars
1. **You move through the arena, not around in it.** Momentum is preserved and rewarded.
2. **Skill ceiling, low floor.** Beginners move normally; experts chain jumps, pads and rocket jumps to extreme speed.
3. **Control wins matches.** Items, armour, health and power-ups are contested resources on a respawn timer.
4. **Instant action.** Link to first shot in under 10 seconds.
5. **Readable chaos.** Strong silhouettes, clear audio cues, visible pads.

## 3. Game modes
- **Free-For-All Deathmatch (launch mode):** frag limit or time limit; the core Q3 experience.
- **1v1 Duel:** map control and item timing.
- **Team Deathmatch:** after FFA is solid.
- **Instagib (rail only):** cheap to build, good for testing.
- Later: CTF, custom games, bots.

## 4. Movement (the heart of the game)
Design principle: **momentum preservation.** Speed is built by skilled movement, not by holding sprint.

### Basics
WASD, sprint, jump, crouch, slide, acceleration, deceleration. Speed is carried through jumps, slides and landings.

### Air control and air strafing
Players steer in the air. Skilled loop: jump, strafe, change direction, keep momentum, land at a new angle, jump again immediately.

### Bunny hopping (skill-based, never automatic)
Jump, strafe, land, jump again, accelerate, repeat. Correct timing keeps or increases speed; poor timing loses speed. It rewards timing, mouse movement, strafing, route choice and momentum management. There is **no auto-hop mode**.

### Explosive / rocket jumping
A projectile detonating near the player's feet launches them up and forward. Used for secret areas, gaps, escapes, high platforms, power weapons, aggressive attacks and alternate routes. Intentionally hard, very rewarding. Self-damage keeps it costly.

### Plasma-assisted movement
Plasma weapon knockback gives small, controllable mid-air boosts.

### Wall jumps
Limited wall jump off valid surfaces, with a short cooldown, to extend routes without becoming free flight.

### Slide
Crouch while sprinting to slide. Preserves speed, lowers the hitbox, and can chain into a jump.

### Bounce pads (visible, readable, three strengths)
| Tier | Use |
|---|---|
| Small | Minor vertical transitions, dodging, reaching platforms |
| Medium | Upper floors, gaps, rapid rotations |
| Mega launch | Extreme vertical traversal, crossing whole sections, aerial combat |

Players combine pads with air strafing to control landing position.

### Jump pads (directional)
Each launches along a fixed trajectory, for example floor to upper platform, lower arena to weapon platform, centre to side tower, arena to secret route. They are part of each map's movement language, not decoration.

### Other traversal
Teleporters, moving platforms, launch ramps.

> Note: the pasted prompt was cut off in section 6 (jump pads). Anything after that, such as weapons, maps, items, modes and netcode, still needs to be sent.

## 5. Weapons (original, Q3-style roles)
| Slot | Weapon | Role |
|---|---|---|
| 1 | Melee blade | Backup, fast, no ammo |
| 2 | Pulse Pistol | Weak sidearm, starting weapon |
| 3 | Scattergun | Close-range burst, hitscan pellets |
| 4 | Nailer | Rapid projectiles, mid range |
| 5 | Rocket Launcher | Splash, rocket jumps |
| 6 | Arc Gun | Continuous short-range beam, high skill |
| 7 | Railgun | Instant hitscan, one slow shot, ultimate aim reward |
| 8 | Plasma Rifle | Fast projectile stream with small push |

Weapon pickups are on the map with respawn timers. The railgun and rocket launcher sit on contested, high-risk spots.

## 6. Items and power-ups
- Health: small, medium, mega. Armour: shard, light, heavy.
- Power-ups: **Overcharge** (damage multiplier, the "Quad" role), Haste, Regeneration, Invisibility. Strong audio and visual cues; timed; dropped on death.
- Respawn timers are shown to spectators and learned by players; item control is the strategy layer.

## 7. Tech
- **Client:** Three.js, TypeScript, Vite. Custom Quake-style player controller with swept-AABB collision against level geometry using BVH (`three-mesh-bvh`). Web Audio with positional sound.
- **Multiplayer (core, not later):** authoritative server (Node.js plus WebSocket, WebTransport later). Fixed 60 Hz simulation tick, client-side prediction with reconciliation for movement, entity interpolation for other players, lag-compensated hitscan (rewind) for railgun. Shared movement code between client and server so prediction matches.
- **Levels:** Blender or TrenchBroom to glTF plus JSON entity layer (spawns, items, pads, teleporters, triggers).
- **Targets:** 60+ fps on integrated GPUs, desktop first, keyboard and mouse with Pointer Lock. Server tick budget for 8 to 16 players per match.

## 8. Maps
- Vertical arenas with several routes per area, jump pads, teleporters and moving platforms.
- First maps: one small duel map, one medium FFA map, one large vertical FFA map.
- Each map is designed around its movement language and an item flow loop (power weapon, armour, mega health, power-up).

## 9. Art and audio
- **Tone: gritty sci-fi.** Worn metal, scratched panels, hazard markings, grime and rust against clean glowing energy. Dark, heavy architecture lit by vivid accents.
- Crisp PBR-ish materials, dynamic lights, bloom, particles, clean readable models. Colour-coded zones and bright pad language.

### Skybox: the showpiece
The sky is a main selling point: a vast, futuristic deep-space vista that looks far better than Q3's black void.
- **Aurora curtains:** flowing northern-lights ribbons (greens, teals, magentas, violets) drawn with animated noise shaders, slowly rippling and shifting across the sky.
- **Deep space:** dense star field with colour variation, faint nebula clouds, and a distant gas giant or ringed planet and a pulsing star.
- **Futuristic details:** far-off megastructures, orbital rings, drifting debris and slow-moving ships.
- **Light that matters:** sky colours tint the arena (rim light, reflections on wet and metal surfaces) so the world and sky feel connected.
- **Per-map identity:** each map gets its own sky preset (aurora palette, planet, nebula) driven by shader parameters.
- **Tech:** a procedural GLSL sky dome (fbm noise aurora, parallax layers) plus optional HDR cubemap for reflections. Quality tiers (Low/Med/High) so integrated GPUs keep 60 fps.
- Original sound design and an original driving soundtrack.
- Player models: a small set of original characters with clear team and enemy readability.

## 10. UI
Minimal HUD: health, armour, ammo, power-up timers, frag feed, scoreboard (Tab), crosshair options, damage direction. Settings: sensitivity, FOV, key binds, crosshair, graphics, audio.

## 11. Milestones
| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Vite plus Three.js plus Node server run; empty room renders; repo has CI |
| M1 | Movement | Quake-feel walk, jump, air-strafe, bunny hop, slide, crouch, collision |
| M2 | Pads and traversal | Bounce pads (3 tiers), jump pads, teleporters |
| M3 | Weapons | Rail, rocket (rocket jump), plasma, scattergun with hit feedback |
| M4 | Netcode | 2 clients play together with prediction and lag-compensated rail |
| M5 | First map plus FFA | Items, respawns, power-up, scoreboard, frag limit, streak medals |
| M5b | Bots | 3 skill tiers, nav graph, FFA vs bots works offline |
| M5c | Skybox | Procedural aurora and deep-space sky shader, per-map presets, quality tiers |
| M6 | Polish | Audio, post-fx, menus, settings, performance |
| M7 | Public playtest | Hosted server plus link, feedback round |

## 12. Open questions
- ~~Tone~~: decided, gritty sci-fi with an aurora-and-deep-space skybox.
- ~~Bots~~: decided, in scope (section 14).
- Hosting for the game server?
- Asset sourcing: self-made, CC0 packs or AI-generated?
- The rest of the master prompt (it was cut off after jump pads).

## 13. References
- "Quake III: Arena - Railgun Frenzy with Quad Damage" (YouTube, DxlJx_dznj4). Watched via 13 extracted frames (720p, 43 s). Findings:
  - **Format:** FFA deathmatch vs 3 bots, frag limit 25, rail-driven chain with Quad Damage.
  - **Map style:** floating platforms over a void (fall = death), jump pads connecting platforms, strong verticality.
  - **HUD to match in spirit (not copy):** big health, armour and ammo numerals bottom; weapon icon plus score box (frag limit, score, rank) bottom right; killfeed top left; centre "You fragged X, 1st place with N"; stacked medal icons for streaks; rival portrait top right; pickup text ("Quad Damage").
  - **Rail:** instant hit, coloured beam trail, one shot per kill under Quad.
  - **Takeaway:** bots are part of the experience, so they move into the launch scope (see below).

## 14. Bots (added from the reference)
Solo and warm-up play against AI bots with names and portraits, three skill tiers, using the same movement code as players. Needed so the game is fun before there is a player base.

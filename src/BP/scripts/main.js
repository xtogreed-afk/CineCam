import { world, system } from "@minecraft/server";


function setInvisible(player, val) {
    try {
        if (val) {
            player.addEffect("invisibility", 99999, { amplifier: 0, showParticles: false });
        } else {
            player.removeEffect("invisibility");
        }
    } catch {}
}
const activeRuns  = new Map();
const watchRuns   = new Map();
const shiftTimers = new Map();
const shiftHeld   = new Map();
const currentMode = new Map();

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return a + d * t;
}
function sway(tick, freq, amp) {
    return Math.sin(tick * freq) * amp + Math.sin(tick * freq * 1.7 + 1.2) * amp * 0.4;
}

function stopCamLoop(player) {
    const id = activeRuns.get(player.id);
    if (id !== undefined) { system.clearRun(id); activeRuns.delete(player.id); }
    setInvisible(player, false);
    currentMode.set(player.id, "off");
    
    system.runTimeout(() => {
        try { player.camera.clear(); } catch {}
    }, 3);
}

function startCinematic(player) {
    stopCamLoop(player);
    currentMode.set(player.id, "first");
    setInvisible(player, true);
    let tick = 0;
    const rot = player.getRotation();
    let syaw = rot.y, spitch = rot.x;

    const id = system.runInterval(() => {
        if (!player.isValid) { stopCamLoop(player); return; }
        const l = player.location, r = player.getRotation();

        syaw   = lerpAngle(syaw,   r.y, 0.14);
        spitch = lerpAngle(spitch, r.x, 0.14);

        const yr2 = syaw * Math.PI / 180;
        const fwdX = -Math.sin(yr2) * 0.3;
        const fwdZ =  Math.cos(yr2) * 0.3;
        player.camera.setCamera("minecraft:free", {
            location: { x: l.x + fwdX, y: l.y + 1.62, z: l.z + fwdZ },
            rotation: {
                x: spitch + sway(tick, 0.010, 0.03),
                y: syaw   + sway(tick, 0.008, 0.04)
            }
        });
        tick++;
    }, 1);
    activeRuns.set(player.id, id);
}


function startThirdPerson(player, side) {
    stopCamLoop(player);
    setInvisible(player, false);
    currentMode.set(player.id, side === 1 ? "right" : "left");

    // Параметры
    const BACK  = 2.0;        
    const SIDE  = 0.5 * side; 
    const UP    = 0.8;       
    const PITCH = 15;         

    let tick = 0;
    const loc = player.location, rot = player.getRotation();
    let sx = loc.x, sy = loc.y, sz = loc.z;
    let syaw = rot.y;

    const id = system.runInterval(() => {
        if (!player.isValid) { stopCamLoop(player); return; }
        const l = player.location, r = player.getRotation();

        sx = lerp(sx, l.x, 0.12);
        sy = lerp(sy, l.y, 0.12);
        sz = lerp(sz, l.z, 0.12);
        syaw = lerpAngle(syaw, r.y, 0.10);

        const yr = syaw * Math.PI / 180;

        
        const backX  =  Math.sin(yr) * BACK;  
        const backZ  = -Math.cos(yr) * BACK;  
        const rightX =  Math.cos(yr) * SIDE;  
        const rightZ =  Math.sin(yr) * SIDE;  

        player.camera.setCamera("minecraft:free", {
            location: {
                x: sx + backX + rightX,
                y: sy + 1.62 + UP + sway(tick, 0.028, 0.010),
                z: sz + backZ + rightZ
            },
            rotation: {
                x: PITCH + sway(tick, 0.020, 0.06),
                y: syaw  + sway(tick, 0.016, 0.12)
            }
        });
        tick++;
    }, 1);
    activeRuns.set(player.id, id);
}


function getShiftBar(ticks) {
    const sec = ticks / 20;
    const filled = Math.min(Math.floor((sec / 4.0) * 16), 16);
    const bar = "§8[§a" + "█".repeat(filled) + "§7" + "░".repeat(16 - filled) + "§8]";
    let hint;
    if      (sec < 0.5) hint = "§7 < 0.5s — §8nothing";
    else if (sec < 2.0) hint = "§7 < 2s — §aFirst person";
    else if (sec < 3.0) hint = "§7 < 3s — §eRight shoulder";
    else if (sec < 4.0) hint = "§7 < 4s — §6Left shoulder";
    else                hint = "§c ≥ 4s — OFF";
    return `${bar} §f${sec.toFixed(1)}с${hint}`;
}


function startWatcher(player) {
    if (watchRuns.has(player.id)) return;

    shiftHeld.set(player.id, false);
    shiftTimers.set(player.id, 0);
    currentMode.set(player.id, "off");

    startCinematic(player);
    player.onScreenDisplay.setActionBar("§b✦ CINECAM §aACTIVE  §7Hold Shift to switch mode");

    const watchId = system.runInterval(() => {
        if (!player.isValid) {
            system.clearRun(watchId);
            watchRuns.delete(player.id);
            shiftHeld.delete(player.id);
            shiftTimers.delete(player.id);
            return;
        }

        const isSneaking = player.isSneaking;
        const wasHeld    = shiftHeld.get(player.id) ?? false;

        if (isSneaking) {
            const ticks = (shiftTimers.get(player.id) ?? 0) + 1;
            shiftTimers.set(player.id, ticks);
            shiftHeld.set(player.id, true);
            player.onScreenDisplay.setActionBar(getShiftBar(ticks));
        } else if (wasHeld) {
            const ticks = shiftTimers.get(player.id) ?? 0;
            const sec   = ticks / 20;
            shiftTimers.set(player.id, 0);
            shiftHeld.set(player.id, false);

            if (sec >= 4.0) {
                stopCamLoop(player);
                player.onScreenDisplay.setActionBar("§c■ STOPPING...  §aDONE!  §7Hold 0.5s to enable again");
            } else if (sec >= 3.0) {
                startThirdPerson(player, -1);
                player.onScreenDisplay.setActionBar("§b✦ CINECAM  §6LEFT SHOULDER");
            } else if (sec >= 2.0) {
                startThirdPerson(player, 1);
                player.onScreenDisplay.setActionBar("§b✦ CINECAM  §eRIGHT SHOULDER");
            } else if (sec >= 0.5) {
                startCinematic(player);
                player.onScreenDisplay.setActionBar("§b✦ CINECAM  §aFIRST PERSON");
            }
        }
    }, 1);

    watchRuns.set(player.id, watchId);
}


world.afterEvents.playerSpawn.subscribe(ev => {
    if (!ev.initialSpawn) return;
    system.runTimeout(() => startWatcher(ev.player), 20);
});
  

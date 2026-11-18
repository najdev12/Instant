(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  const overlay = $("overlay");
  const hud = $("hud");
  const blurb = $("blurb");
  const playBtn = $("play");
  const kicker = $("kicker");
  const result = $("result");
  const help = $("help");
  const record = $("record");
  const banner = $("banner");
  const damageEl = $("damage");
  const crosshair = $("crosshair");
  const muteEl = $("mute");

  if (!window.THREE) {
    blurb.textContent = "The 3D engine did not load. Keep the vendor folder next to this page and reload.";
    playBtn.disabled = true;
    return;
  }

  try {
    boot();
  } catch (err) {
    console.error(err);
    blurb.textContent = "The pit failed to build: " + err.message;
    playBtn.disabled = true;
  }

  function boot() {
    const ARENA = 18;
    const CHARGE = 0.52;
    const PLAYER_SPEED = 8.6;
    const TURN_SPEED = 2.9;
    const PLAYER_DMG = 25;
    const ENEMY_DMG = 13;
    const FIRE_DELAY = 0.28;
    const SPAWN = {
      player: { x: -14.5, z: 5.2 },
      enemy: { x: 14.5, z: -5.2 },
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const held = new Set();
    const solids = [];
    const bullets = [];
    const sparks = [];
    const wins = { you: 0, foe: 0 };

    let phase = "menu";
    let engage = 0;
    let time = 0;
    let menuAng = 0.85;
    let pitch = 0;
    let shake = 0;
    let bob = 0;
    let playerCd = 0;
    let damageFlash = 0;
    let hitUntil = 0;
    let muted = false;

    const player = { x: SPAWN.player.x, z: SPAWN.player.z, yaw: 0, hp: 100, moving: false };
    const enemy = {
      x: SPAWN.enemy.x,
      z: SPAWN.enemy.z,
      hp: 100,
      charge: 0,
      cd: 0.4,
      flash: 0,
      strafe: 1,
      strafeT: 1.4,
      moving: false,
    };

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const enemyCenter = new THREE.Vector3();
    const playerCenter = new THREE.Vector3();

    let audioCtx = null;
    let master = null;

    selfTest();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10131a);
    scene.fog = new THREE.Fog(0x10131a, 24, 62);

    const camera = new THREE.PerspectiveCamera(73, window.innerWidth / window.innerHeight, 0.05, 140);
    camera.rotation.order = "YXZ";
    scene.add(camera);

    const gun = buildViewmodel();
    const muzzleLight = new THREE.PointLight(0xcfe9ff, 0, 7, 2);
    muzzleLight.position.set(0, 0.04, -0.48);
    gun.add(muzzleLight);

    const hemi = new THREE.HemisphereLight(0xc5d2e8, 0x2a2118, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.4);
    sun.position.set(10, 22, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);

    buildArena();
    const rival = buildFighter(0xc4372f, 0xffd2a8);
    const dummy = buildFighter(0x7f93a8, 0xc5e4ff);
    enemy.mesh = rival.group;
    enemy.mats = rival.mats;
    enemy.leftLeg = rival.leftLeg;
    enemy.rightLeg = rival.rightLeg;
    scene.add(rival.group);
    scene.add(dummy.group);

    const beamGeo = new THREE.BoxGeometry(0.055, 0.055, 1);
    beamGeo.translate(0, 0, -0.5);
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.visible = false;
    beam.frustumCulled = false;
    scene.add(beam);

    const bulletGeo = new THREE.BoxGeometry(0.07, 0.07, 0.42);
    const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff7a45 });
    const sparkGeo = new THREE.SphereGeometry(0.1, 8, 6);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", (e) => held.delete(e.code));
    window.addEventListener("blur", () => held.clear());
    window.addEventListener("resize", resize);
    playBtn.addEventListener("click", () => {
      unlock();
      primary();
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const clock = new THREE.Clock();
    requestAnimationFrame(tick);

    function tick() {
      const dt = Math.min(0.05, clock.getDelta());
      time += dt;
      if (phase === "play") {
        engage = Math.max(0, engage - dt);
        updatePlayer(dt);
        updateEnemy(dt);
        separateActors();
        updateFpsCam(dt);
        tryFire(dt);
      } else if (phase === "pause" || phase === "end") {
        updateFpsCam(dt);
        enemy.mesh.position.set(enemy.x, enemy.hp <= 0 ? -0.55 : 0, enemy.z);
        if (enemy.hp <= 0) enemy.mesh.rotation.x = 1.05;
      } else {
        updateMenu(dt);
      }
      updateBullets(dt);
      updateSparks(dt);
      damageFlash = Math.max(0, damageFlash - dt * 1.35);
      damageEl.style.opacity = String(damageFlash);
      updateHud();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }

    function updateMenu(dt) {
      menuAng += dt * (reduceMotion ? 0 : 0.2);
      camera.position.set(Math.sin(menuAng) * 7.2, 12.4, Math.cos(menuAng) * 7.2);
      camera.lookAt(0, 0.5, 0);
      gun.visible = false;
      dummy.group.visible = true;
      const breathe = Math.sin(time * 1.7) * 0.035;
      dummy.group.position.set(SPAWN.player.x, breathe, SPAWN.player.z);
      enemy.mesh.position.set(SPAWN.enemy.x, -breathe, SPAWN.enemy.z);
      dummy.group.lookAt(SPAWN.enemy.x, 0, SPAWN.enemy.z);
      enemy.mesh.lookAt(SPAWN.player.x, 0, SPAWN.player.z);
      const swing = Math.sin(time * 2) * 0.18;
      dummy.leftLeg.rotation.x = swing;
      dummy.rightLeg.rotation.x = -swing;
      enemy.leftLeg.rotation.x = -swing;
      enemy.rightLeg.rotation.x = swing;
      hideBeam();
    }

    function updatePlayer(dt) {
      let turn = 0;
      if (held.has("ArrowLeft")) turn += 1;
      if (held.has("ArrowRight")) turn -= 1;
      player.yaw += turn * TURN_SPEED * dt;
      let move = 0;
      if (held.has("ArrowUp")) move += 1;
      if (held.has("ArrowDown")) move -= 1;
      player.x += -Math.sin(player.yaw) * move * PLAYER_SPEED * dt;
      player.z += -Math.cos(player.yaw) * move * PLAYER_SPEED * dt;
      moveActor(player, 0.45);
      player.moving = move !== 0;
    }

    function updateEnemy(dt) {
      enemy.flash = Math.max(0, enemy.flash - dt);
      for (const mat of enemy.mats) mat.emissiveIntensity = enemy.flash > 0 ? 0.95 : 0.16;

      const dx = player.x - enemy.x;
      const dz = player.z - enemy.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      const fx = dx / dist;
      const fz = dz / dist;
      enemy.strafeT -= dt;
      if (enemy.strafeT <= 0) {
        enemy.strafe *= -1;
        enemy.strafeT = 1.3 + Math.random() * 1.5;
      }
      let mx = -fz * enemy.strafe;
      let mz = fx * enemy.strafe;
      if (dist > 11) {
        mx += fx;
        mz += fz;
      } else if (dist < 6.5) {
        mx -= fx;
        mz -= fz;
      }
      const mag = Math.hypot(mx, mz) || 1;
      const spd = dist > 16 ? 7.1 : 5.35;
      const ox = enemy.x;
      const oz = enemy.z;
      enemy.x += (mx / mag) * spd * dt;
      enemy.z += (mz / mag) * spd * dt;
      moveActor(enemy, 0.5);
      const moved = Math.hypot(enemy.x - ox, enemy.z - oz);
      enemy.moving = moved > 0.015;
      if (mx !== 0 && moved < spd * dt * 0.22) {
        enemy.strafe *= -1;
        enemy.strafeT = 0.7;
      }

      const feetY = 0;
      enemy.mesh.position.set(enemy.x, feetY, enemy.z);
      enemy.mesh.lookAt(player.x, feetY, player.z);
      enemy.mesh.updateMatrixWorld(true);
      const swing = Math.sin(time * 8.5) * (enemy.moving ? 0.75 : 0);
      enemy.leftLeg.rotation.x = swing;
      enemy.rightLeg.rotation.x = -swing;

      enemy.cd = Math.max(0, enemy.cd - dt);
      const muzzle = enemyMuzzle(v0);
      const target = v1.set(player.x, 1.2, player.z);
      const blocked = sightBlocked(muzzle, target);
      const ready = engage <= 0 && player.hp > 0 && enemy.hp > 0 && dist < 28;
      if (ready && !blocked && enemy.cd <= 0) {
        enemy.charge = Math.min(CHARGE, enemy.charge + dt * (dist < 5 ? 1.7 : 1));
        aimBeam(muzzle, target, enemy.charge / CHARGE);
        if (enemy.charge >= CHARGE) {
          v2.set(target.x - muzzle.x, target.y - muzzle.y, target.z - muzzle.z).normalize();
          v3.set(-v2.z, 0, v2.x);
          if (v3.lengthSq() < 1e-6) v3.set(1, 0, 0);
          v3.normalize();
          const spread = THREE.MathUtils.lerp(0.012, 0.08, Math.min(dist / 24, 1));
          v2.addScaledVector(v3, (Math.random() - 0.5) * spread * 2);
          v2.y += (Math.random() - 0.5) * spread * 0.5;
          v2.normalize();
          spawnBullet(muzzle, v2, 17.5);
          sfxShoot(true);
          enemy.charge = 0;
          enemy.cd = 0.72;
          hideBeam();
        }
      } else {
        enemy.charge = Math.max(0, enemy.charge - dt * 2.2);
        if (enemy.charge > 0.03 && !blocked) aimBeam(muzzle, target, enemy.charge / CHARGE);
        else hideBeam();
      }
    }

    function updateFpsCam(dt) {
      pitch *= Math.exp(-dt * 7);
      bob += dt * (player.moving && phase === "play" ? 10 : 1.2);
      const bobY = player.moving && phase === "play" ? Math.sin(bob) * 0.045 : 0;
      camera.position.set(player.x, 1.6 + bobY, player.z);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake * 0.5;
        shake = Math.max(0, shake - dt * 0.85);
      }
      camera.rotation.order = "YXZ";
      camera.rotation.x = pitch;
      camera.rotation.y = player.yaw;
      camera.rotation.z = 0;
      gun.visible = true;
      gun.position.y = -0.25 + Math.sin(bob * 2) * (player.moving && phase === "play" ? 0.012 : 0);
      gun.position.z = -0.5 - pitch * 0.4;
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 80);
      dummy.group.visible = false;
    }

    function tryFire(dt) {
      playerCd = Math.max(0, playerCd - dt);
      if (engage > 0 || player.hp <= 0) return;
      if (!held.has("Space") || playerCd > 0) return;
      playerCd = FIRE_DELAY;
      camera.getWorldDirection(v2);
      const origin = camera.localToWorld(v0.set(0.04, -0.03, -0.72));
      const far = v1.copy(origin).addScaledVector(v2, 70);
      enemyCenter.set(enemy.x, 1.2, enemy.z);
      let bestT = 1;
      let kind = "none";
      if (enemy.hp > 0) {
        const tHit = segmentSphereT(origin, far, enemyCenter, 0.9);
        if (tHit !== null) {
          bestT = tHit;
          kind = "enemy";
        }
      }
      for (const solid of solids) {
        const tWall = segmentBoxT(origin, far, solid);
        if (tWall !== null && tWall > 0.001 && tWall < bestT) {
          bestT = tWall;
          kind = "wall";
        }
      }
      const hit = pointAt(origin, far, bestT, v3);
      tracer(origin, hit);
      if (kind !== "none") spark(hit, kind === "enemy" ? 0xffe3a3 : 0xd5e7ff);
      if (kind === "enemy") damageEnemy(PLAYER_DMG);
      pitch = Math.min(0.11, pitch + 0.045);
      muzzleLight.intensity = 16;
      sfxShoot(false);
    }

    function updateBullets(dt) {
      playerCenter.set(player.x, 1.15, player.z);
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.age += dt;
        const p0x = b.mesh.position.x;
        const p0y = b.mesh.position.y;
        const p0z = b.mesh.position.z;
        const p1x = p0x + b.dir.x * b.speed * dt;
        const p1y = p0y + b.dir.y * b.speed * dt;
        const p1z = p0z + b.dir.z * b.speed * dt;
        const p0 = { x: p0x, y: p0y, z: p0z };
        const p1 = { x: p1x, y: p1y, z: p1z };
        let bestT = null;
        let kind = null;
        if (b.age > 0.04 && phase === "play" && player.hp > 0) {
          const tHit = segmentSphereT(p0, p1, playerCenter, 0.7);
          if (tHit !== null) {
            bestT = tHit;
            kind = "player";
          }
        }
        for (const solid of solids) {
          const tWall = segmentBoxT(p0, p1, solid);
          if (tWall !== null && tWall > 0 && (bestT === null || tWall < bestT)) {
            bestT = tWall;
            kind = "wall";
          }
        }
        if (bestT !== null) {
          spark(
            {
              x: p0x + (p1x - p0x) * bestT,
              y: p0y + (p1y - p0y) * bestT,
              z: p0z + (p1z - p0z) * bestT,
            },
            0xff7a45
          );
          if (kind === "player") damagePlayer(ENEMY_DMG);
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        } else if (b.age > 2.2) {
          scene.remove(b.mesh);
          bullets.splice(i, 1);
        } else {
          b.mesh.position.set(p1x, p1y, p1z);
        }
      }
    }

    function updateSparks(dt) {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dt;
        if (s.life <= 0) {
          scene.remove(s.mesh);
          if (s.line) s.mesh.geometry.dispose();
          s.mesh.material.dispose();
          sparks.splice(i, 1);
          continue;
        }
        const k = s.life / s.max;
        s.mesh.material.opacity = k;
        if (!s.line) s.mesh.scale.setScalar(1 + (1 - k) * 2.6);
      }
    }

    function updateHud() {
      const playing = phase === "play";
      document.body.classList.toggle("playing", playing);
      $("hp-you").textContent = String(Math.ceil(player.hp));
      $("hp-foe").textContent = String(Math.ceil(enemy.hp));
      $("bar-you").style.transform = `scaleX(${clamp(player.hp / 100, 0, 1)})`;
      $("bar-foe").style.transform = `scaleX(${clamp(enemy.hp / 100, 0, 1)})`;
      $("lock").style.transform = `scaleX(${clamp(enemy.charge / CHARGE, 0, 1)})`;
      $("score").textContent = `${wins.you} — ${wins.foe}`;
      $("compass").textContent = compassLabel(player.yaw);
      hud.classList.toggle("critical", phase !== "menu" && player.hp > 0 && player.hp <= 30);
      const gap = 8 + (player.moving && playing ? 5 : 0) + pitch * 70 + (playerCd > 0 ? 4 : 0);
      crosshair.style.setProperty("--gap", `${gap}px`);
      crosshair.classList.toggle("hit", performance.now() < hitUntil);
      crosshair.classList.toggle("locked", playing && acquireLock());
      crosshair.hidden = !playing;
    }

    function acquireLock() {
      if (enemy.hp <= 0) return false;
      const dx = enemy.x - player.x;
      const dz = enemy.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.8 || dist > 40) return false;
      let diff = Math.atan2(-dx, -dz) - player.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const allowance = Math.atan2(0.9, dist) + 0.012;
      if (Math.abs(diff) > allowance) return false;
      return !sightBlocked({ x: player.x, y: 1.55, z: player.z }, { x: enemy.x, y: 1.2, z: enemy.z });
    }

    function beginRound() {
      player.x = SPAWN.player.x;
      player.z = SPAWN.player.z;
      player.hp = 100;
      player.yaw = Math.atan2(-(SPAWN.enemy.x - player.x), -(SPAWN.enemy.z - player.z));
      enemy.x = SPAWN.enemy.x;
      enemy.z = SPAWN.enemy.z;
      enemy.hp = 100;
      enemy.charge = 0;
      enemy.cd = 0.45;
      enemy.flash = 0;
      enemy.strafe = Math.random() < 0.5 ? -1 : 1;
      enemy.strafeT = 1.1;
      for (const mat of enemy.mats) mat.emissiveIntensity = 0.16;
      playerCd = 0;
      pitch = 0;
      shake = 0;
      engage = 0.65;
      damageFlash = 0;
      clearFlight();
      hideBeam();
      phase = "play";
      overlay.hidden = true;
      hud.hidden = false;
      announce("ENGAGE");
      canvas.focus({ preventScroll: true });
    }

    function finish() {
      if (phase !== "play") return;
      phase = "end";
      hideBeam();
      held.clear();
      const win = enemy.hp <= 0 && player.hp > 0;
      const lose = player.hp <= 0 && enemy.hp > 0;
      if (win) wins.you += 1;
      else if (lose) wins.foe += 1;
      if (enemy.hp <= 0) enemy.mesh.position.y = -0.55;
      showScreen(win ? "win" : lose ? "lose" : "draw");
      chime(win && !lose);
    }

    function showScreen(mode) {
      overlay.hidden = false;
      overlay.classList.toggle("cinematic", mode === "menu");
      overlay.dataset.outcome = mode;
      record.textContent = `YOU ${wins.you}  ·  ${wins.foe} WARDEN`;
      help.hidden = mode === "win" || mode === "lose" || mode === "draw";
      hud.hidden = mode === "menu";
      if (mode === "menu") {
        kicker.textContent = "3D ARENA DUEL";
        result.textContent = "";
        blurb.textContent = "One pit, one rival. Turn with the arrows, walk the lane, and drop Warden before the return shot lands.";
        playBtn.textContent = "ENTER THE PIT";
      } else if (mode === "pause") {
        kicker.textContent = "HOLDING";
        result.textContent = "PAUSED";
        blurb.textContent = "Same health, same ground. Step back in when you are ready.";
        playBtn.textContent = "RESUME";
      } else if (mode === "win") {
        kicker.textContent = "DUEL OVER";
        result.textContent = "WARDEN DOWN";
        blurb.textContent = "You kept the pit. Run it back when you want a cleaner fight.";
        playBtn.textContent = "RUN IT BACK";
      } else if (mode === "lose") {
        kicker.textContent = "DUEL OVER";
        result.textContent = "YOU ARE DOWN";
        blurb.textContent = "Warden holds the yard. Change your angle and take it back.";
        playBtn.textContent = "RUN IT BACK";
      } else {
        kicker.textContent = "DUEL OVER";
        result.textContent = "BOTH DOWN";
        blurb.textContent = "You dropped together. The pit calls that a draw.";
        playBtn.textContent = "RUN IT BACK";
      }
    }

    function primary() {
      if (phase === "play") return;
      if (phase === "pause") {
        phase = "play";
        overlay.hidden = true;
        canvas.focus({ preventScroll: true });
        return;
      }
      beginRound();
    }

    function togglePause() {
      if (phase === "play") {
        phase = "pause";
        hideBeam();
        held.delete("Space");
        showScreen("pause");
      } else if (phase === "pause") {
        primary();
      }
    }

    function damagePlayer(amount) {
      if (phase !== "play" || engage > 0 || player.hp <= 0) return;
      player.hp = Math.max(0, player.hp - amount);
      damageFlash = 0.78;
      shake = 0.16;
      sfxHurt();
      if (player.hp <= 0) finish();
    }

    function damageEnemy(amount) {
      if (phase !== "play" || engage > 0 || enemy.hp <= 0) return;
      enemy.hp = Math.max(0, enemy.hp - amount);
      enemy.flash = 0.12;
      hitUntil = performance.now() + 110;
      sfxConfirm();
      if (enemy.hp <= 0) finish();
    }

    function onKeyDown(e) {
      const control = e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Space";
      if (control) e.preventDefault();
      if (e.repeat) return;
      held.add(e.code);
      unlock();
      if (e.code === "KeyM") {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.35;
        muteEl.hidden = !muted;
      } else if (e.code === "Escape") {
        togglePause();
      } else if (e.code === "Enter" || (e.code === "Space" && phase !== "play")) {
        held.delete("Space");
        primary();
      }
    }

    function announce(text) {
      banner.textContent = text;
      banner.classList.remove("show");
      void banner.offsetWidth;
      banner.classList.add("show");
    }

    function resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }

    function moveActor(actor, radius) {
      const limit = ARENA - radius;
      actor.x = clamp(actor.x, -limit, limit);
      actor.z = clamp(actor.z, -limit, limit);
      for (let pass = 0; pass < 3; pass++) {
        for (const solid of solids) {
          const minX = solid.min.x - radius;
          const maxX = solid.max.x + radius;
          const minZ = solid.min.z - radius;
          const maxZ = solid.max.z + radius;
          if (actor.x <= minX || actor.x >= maxX || actor.z <= minZ || actor.z >= maxZ) continue;
          const penL = actor.x - minX;
          const penR = maxX - actor.x;
          const penN = actor.z - minZ;
          const penS = maxZ - actor.z;
          const m = Math.min(penL, penR, penN, penS);
          if (m === penL) actor.x = minX;
          else if (m === penR) actor.x = maxX;
          else if (m === penN) actor.z = minZ;
          else actor.z = maxZ;
        }
      }
    }

    function separateActors() {
      let dx = enemy.x - player.x;
      let dz = enemy.z - player.z;
      let dist = Math.hypot(dx, dz);
      const minD = 1.2;
      if (dist >= minD) return;
      if (dist < 0.0001) {
        dx = 1;
        dz = 0;
        dist = 1;
      }
      const push = (minD - dist) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      player.x -= nx * push;
      player.z -= nz * push;
      enemy.x += nx * push;
      enemy.z += nz * push;
      moveActor(player, 0.45);
      moveActor(enemy, 0.5);
      enemy.mesh.position.set(enemy.x, 0, enemy.z);
    }

    function sightBlocked(p0, p1) {
      for (const solid of solids) {
        const t = segmentBoxT(p0, p1, solid);
        if (t !== null && t > 0.03 && t < 0.97) return true;
      }
      return false;
    }

    function enemyMuzzle(out) {
      out.set(0.32, 1.28, -0.62);
      return enemy.mesh.localToWorld(out);
    }

    function aimBeam(from, to, alpha) {
      beam.visible = true;
      beam.position.copy(from);
      beam.lookAt(to);
      beam.scale.set(1, 1, Math.max(0.2, from.distanceTo(to)));
      beam.material.opacity = 0.28 + alpha * 0.6;
    }

    function hideBeam() {
      beam.visible = false;
      beam.material.opacity = 0;
    }

    function spawnBullet(origin, dir, speed) {
      const mesh = new THREE.Mesh(bulletGeo, enemyBulletMat);
      mesh.position.copy(origin);
      const d = dir.clone().normalize();
      mesh.lookAt(origin.x + d.x, origin.y + d.y, origin.z + d.z);
      scene.add(mesh);
      bullets.push({ mesh, dir: d, speed, age: 0 });
    }

    function tracer(from, to) {
      const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xe7f6ff, transparent: true, opacity: 0.95 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      sparks.push({ mesh: line, life: 0.07, max: 0.07, line: true });
    }

    function spark(pos, color) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      scene.add(mesh);
      sparks.push({ mesh, life: 0.16, max: 0.16, line: false });
    }

    function clearFlight() {
      for (const b of bullets) scene.remove(b.mesh);
      bullets.length = 0;
      for (const s of sparks) {
        scene.remove(s.mesh);
        if (s.line) s.mesh.geometry.dispose();
        s.mesh.material.dispose();
      }
      sparks.length = 0;
    }

    function buildArena() {
      const floorTex = makeFloorTexture();
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
        new THREE.MeshStandardMaterial({ map: floorTex, color: 0xffffff, roughness: 0.92, metalness: 0.04 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      const wallTex = makeWallTexture();
      const T = 1.35;
      const H = 4;
      const span = ARENA * 2 + T * 2;
      addSolid(0, -ARENA - T / 2, span, H, T, wallMaterial(wallTex, span, H));
      addSolid(0, ARENA + T / 2, span, H, T, wallMaterial(wallTex, span, H));
      addSolid(-ARENA - T / 2, 0, T, H, span, wallMaterial(wallTex, span, H));
      addSolid(ARENA + T / 2, 0, T, H, span, wallMaterial(wallTex, span, H));

      const lip = new THREE.MeshBasicMaterial({ color: 0xe4b15a });
      addTrim(0, -ARENA + 0.06, ARENA * 2, 0.1, lip, H);
      addTrim(0, ARENA - 0.06, ARENA * 2, 0.1, lip, H);
      addTrim(-ARENA + 0.06, 0, 0.1, ARENA * 2, lip, H);
      addTrim(ARENA - 0.06, 0, 0.1, ARENA * 2, lip, H);

      const pillar = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9, metalness: 0.05 });
      for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) addSolid(x, z, 2.05, 2.55, 2.05, pillar);

      const barrier = new THREE.MeshStandardMaterial({ color: 0x2c313c, roughness: 0.48, metalness: 0.42 });
      addSolid(0, -11, 7.2, 1.9, 0.82, barrier);
      addSolid(0, 11, 7.2, 1.9, 0.82, barrier);
      const stripe = new THREE.MeshBasicMaterial({ color: 0xe4b15a });
      for (const z of [-11, 11]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(7.24, 0.1, 0.9), stripe);
        band.position.set(0, 1.52, z);
        scene.add(band);
      }

      const crate = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.8, metalness: 0.04 });
      addSolid(-12.2, 0, 1.7, 1.12, 1.7, crate);
      addSolid(12.2, 0, 1.7, 1.12, 1.7, crate);

      const sign = makeSignTexture();
      const plain = new THREE.MeshStandardMaterial({ color: 0x3c342c, roughness: 0.88 });
      const branded = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.72, metalness: 0.08 });
      const monolith = new THREE.Mesh(new THREE.BoxGeometry(2.7, 2.3, 2.7), [branded, branded, plain, plain, branded, branded]);
      monolith.position.y = 1.15;
      monolith.castShadow = true;
      monolith.receiveShadow = true;
      scene.add(monolith);
      solids.push({ min: { x: -1.35, y: 0, z: -1.35 }, max: { x: 1.35, y: 2.3, z: 1.35 } });

      addLamp(-15.1, -15.1, 0xffb15a, 36);
      addLamp(15.1, -15.1, 0x9ebfff, 28);
      addLamp(-15.1, 15.1, 0x9ebfff, 28);
      addLamp(15.1, 15.1, 0xffb15a, 36);
    }

    function addSolid(x, z, w, h, d, material) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      solids.push({
        min: { x: x - w / 2, y: 0, z: z - d / 2 },
        max: { x: x + w / 2, y: h, z: z + d / 2 },
      });
    }

    function addTrim(x, z, w, d, material, height) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), material);
      mesh.position.set(x, height + 0.02, z);
      scene.add(mesh);
    }

    function addLamp(x, z, color, intensity) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 2.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x17191f, metalness: 0.65, roughness: 0.32 })
      );
      pole.position.set(x, 1.15, z);
      pole.castShadow = true;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshBasicMaterial({ color }));
      bulb.position.set(x, 2.35, z);
      scene.add(pole, bulb);
      const light = new THREE.PointLight(color, intensity, 16, 2);
      light.position.set(x, 2.35, z);
      scene.add(light);
      solids.push({
        min: { x: x - 0.2, y: 0, z: z - 0.2 },
        max: { x: x + 0.2, y: 2.3, z: z + 0.2 },
      });
    }

    function buildFighter(color, visor) {
      const group = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.46,
        metalness: 0.3,
        emissive: color,
        emissiveIntensity: 0.16,
      });
      const headMat = body.clone();
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.82, 0.42), body);
      torso.position.y = 1.18;
      torso.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 14), headMat);
      head.position.y = 1.74;
      head.castShadow = true;
      const vis = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: visor }));
      vis.position.set(0, 1.76, -0.2);
      const legGeo = new THREE.BoxGeometry(0.16, 0.62, 0.18);
      legGeo.translate(0, -0.31, 0);
      const leftLeg = new THREE.Mesh(legGeo, body);
      const rightLeg = new THREE.Mesh(legGeo, body);
      leftLeg.position.set(-0.17, 0.74, 0);
      rightLeg.position.set(0.17, 0.74, 0);
      leftLeg.castShadow = true;
      rightLeg.castShadow = true;
      const rifle = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.08, 0.48),
        new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.72, roughness: 0.3 })
      );
      rifle.position.set(0.32, 1.16, -0.28);
      group.add(torso, head, vis, leftLeg, rightLeg, rifle);
      return { group, mats: [body, headMat], leftLeg, rightLeg };
    }

    function buildViewmodel() {
      const group = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.72, roughness: 0.28 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.4), metal);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.07), metal);
      grip.position.set(0, -0.1, 0.08);
      grip.rotation.x = 0.35;
      const barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, 0.034, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.8, roughness: 0.25 })
      );
      barrel.position.set(0, 0.035, -0.28);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.08), new THREE.MeshBasicMaterial({ color: 0xe4b15a }));
      accent.position.set(0, 0.065, -0.02);
      group.add(body, grip, barrel, accent);
      group.position.set(0.28, -0.25, -0.5);
      camera.add(group);
      return group;
    }

    function makeFloorTexture() {
      const c = document.createElement("canvas");
      c.width = 1024;
      c.height = 1024;
      const g = c.getContext("2d");
      g.fillStyle = "#191d28";
      g.fillRect(0, 0, 1024, 1024);
      g.strokeStyle = "#2a3142";
      g.lineWidth = 2;
      for (let i = 0; i <= 1024; i += 64) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 1024);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(1024, i);
        g.stroke();
      }
      g.strokeStyle = "#7a342f";
      g.lineWidth = 8;
      g.beginPath();
      g.arc(512, 512, 280, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "#e4b15a";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(512, 512, 150, 0, Math.PI * 2);
      g.stroke();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return tex;
    }

    function makeWallTexture() {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 256;
      const g = c.getContext("2d");
      g.fillStyle = "#323948";
      g.fillRect(0, 0, 128, 256);
      g.fillStyle = "#262c3a";
      g.fillRect(0, 0, 10, 256);
      g.fillRect(118, 0, 10, 256);
      g.fillStyle = "#c9843a";
      g.fillRect(0, 214, 128, 8);
      g.fillStyle = "#1c212c";
      g.fillRect(0, 222, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }

    function wallMaterial(source, w, h) {
      const map = source.clone();
      map.needsUpdate = true;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(Math.max(1, w / 2.2), Math.max(1, h / 2.2));
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.84, metalness: 0.08 });
    }

    function makeSignTexture() {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      const g = c.getContext("2d");
      g.fillStyle = "#3a332c";
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "#e4b15a";
      g.lineWidth = 12;
      g.strokeRect(16, 16, 224, 224);
      g.fillStyle = "#f3efe4";
      g.font = "700 68px Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("YARD", 128, 132);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function compassLabel(yaw) {
      const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      const a = THREE.MathUtils.euclideanModulo(-yaw, Math.PI * 2);
      return dirs[Math.round(a / (Math.PI / 4)) % 8];
    }

    function unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) {
        audioCtx = new AC();
        master = audioCtx.createGain();
        master.gain.value = muted ? 0 : 0.35;
        master.connect(audioCtx.destination);
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    }

    function sfxShoot(foe) {
      if (!audioCtx || muted) return;
      noise(foe ? 0.09 : 0.055, foe ? 0.22 : 0.28, foe ? 520 : 1600);
    }

    function sfxConfirm() {
      if (!audioCtx || muted) return;
      tone(880, 0.05, "square", 0.04);
    }

    function sfxHurt() {
      if (!audioCtx || muted) return;
      tone(140, 0.12, "sawtooth", 0.05, 70);
    }

    function chime(up) {
      if (!audioCtx || muted) return;
      const notes = up ? [523, 659, 784] : [392, 311, 220];
      const now = audioCtx.currentTime;
      notes.forEach((freq, i) => tone(freq, 0.16, "square", 0.045, null, now + i * 0.09));
    }

    function tone(freq, dur, type, vol, slide, when) {
      if (!audioCtx) return;
      const t = when || audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    function noise(dur, vol, freq) {
      const rate = audioCtx.sampleRate;
      const len = Math.max(1, Math.floor(rate * dur));
      const buffer = audioCtx.createBuffer(1, len, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = freq;
      const gain = audioCtx.createGain();
      gain.gain.value = vol;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
    }
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function pointAt(p0, p1, t, out) {
    out.set(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, p0.z + (p1.z - p0.z) * t);
    return out;
  }

  function segmentBoxT(p0, p1, box) {
    const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
    const o = [p0.x, p0.y, p0.z];
    const mn = [box.min.x, box.min.y, box.min.z];
    const mx = [box.max.x, box.max.y, box.max.z];
    let tmin = 0;
    let tmax = 1;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mn[i] || o[i] > mx[i]) return null;
      } else {
        let t1 = (mn[i] - o[i]) / d[i];
        let t2 = (mx[i] - o[i]) / d[i];
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    if (tmax < 0 || tmin > 1) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  function segmentSphereT(p0, p1, center, radius) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const fx = p0.x - center.x;
    const fy = p0.y - center.y;
    const fz = p0.z - center.z;
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-8) return null;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    const c = fx * fx + fy * fy + fz * fz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t2 >= 0 && t2 <= 1) return t2;
    return null;
  }

  function selfTest() {
    const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const hit = segmentBoxT({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, box);
    if (hit === null || Math.abs(hit - 0.25) > 0.02) throw new Error("wall test failed");
    const miss = segmentBoxT({ x: -2, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }, box);
    if (miss !== null) throw new Error("wall miss failed");
    const sphere = segmentSphereT({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1);
    if (sphere === null || Math.abs(sphere - 0.25) > 0.02) throw new Error("shot test failed");
  }
})();

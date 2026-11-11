/** 코드로 그린 그림을 Phaser 텍스처/애니메이션으로 등록 */
import Phaser from 'phaser';
import { FOOD_IDS } from '../../../shared/protocol';
import { WORLD, type PropKind } from '../../../shared/map';
import { buildCharacterSheet, characterKey, DIR_ROWS, FRAME_H, FRAME_W, SHEET_COLS } from './art/characters';
import { buildCrumb, buildFood, buildHeart, buildRippleSheet, buildStar, buildSteam, buildSweat } from './art/foods';
import { bakeGround } from './art/ground';
import { buildBalloon, buildDrop, buildEmote, buildHammer, buildImpact, buildPlane, buildTeamBadge, buildTeamRing } from './art/social';
import { EMOTES, TEAMS } from '../../../shared/social';
import {
  buildDot,
  buildFlameSheet,
  buildGlow,
  buildProp,
  buildShadow,
  buildSparkle,
  buildSwirlSheet,
  propTextureKey,
} from './art/props';

function addSheet(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement, fw: number, fh: number, count: number) {
  const tex = scene.textures.addCanvas(key, canvas)!;
  for (let i = 0; i < count; i++) tex.add(i, 0, i * fw, 0, fw, fh);
}

export function registerStaticTextures(scene: Phaser.Scene) {
  const t = scene.textures;
  if (t.exists('ground')) return;
  t.addCanvas('ground', bakeGround());

  const kinds = new Set<string>();
  for (const p of WORLD.props) {
    const key = propTextureKey(p.kind, p.label);
    if (kinds.has(key)) continue;
    kinds.add(key);
    const art = buildProp(p.kind as PropKind, p.label);
    if (art.frames) {
      addSheet(scene, key, art.canvas, art.frames.w, art.frames.h, art.frames.count);
    } else t.addCanvas(key, art.canvas);
  }

  const flame = buildFlameSheet();
  addSheet(scene, 'flame', flame.canvas, flame.w, flame.h, flame.count);
  const swirl = buildSwirlSheet();
  addSheet(scene, 'swirl', swirl.canvas, swirl.w, swirl.h, swirl.count);
  const ripple = buildRippleSheet();
  addSheet(scene, 'ripple', ripple.canvas, ripple.w, ripple.h, ripple.count);
  t.addCanvas('glow', buildGlow(64));
  t.addCanvas('glowViolet', buildGlow(64, '190,160,255'));
  t.addCanvas('glowWarm', buildGlow(64, '255,190,160'));
  t.addCanvas('shadow', buildShadow());
  t.addCanvas('sparkle', buildSparkle());
  t.addCanvas('ember', buildDot('#ffc65a', 2));
  t.addCanvas('mote', buildDot('#fff6c8', 1));
  t.addCanvas('heart', buildHeart());
  t.addCanvas('star', buildStar());
  t.addCanvas('sweat', buildSweat());
  t.addCanvas('steam', buildSteam(12));
  t.addCanvas('crumb', buildCrumb());
  for (const id of FOOD_IDS) t.addCanvas(`food-${id}`, buildFood(id));
  for (const e of EMOTES) t.addCanvas(`emote-${e}`, buildEmote(e));
  for (const tm of TEAMS) {
    t.addCanvas(`ring-${tm.id}`, buildTeamRing(tm.color));
    t.addCanvas(`team-${tm.id}`, buildTeamBadge(tm.id));
  }
  t.addCanvas('plane', buildPlane());
  t.addCanvas('balloon', buildBalloon());
  t.addCanvas('drop', buildDrop());
  t.addCanvas('hammer', buildHammer());
  t.addCanvas('impact', buildImpact());

  const anims = scene.anims;
  anims.create({ key: 'flame', frames: anims.generateFrameNumbers('flame', { start: 0, end: 3 }), frameRate: 9, repeat: -1 });
  anims.create({ key: 'swirl', frames: anims.generateFrameNumbers('swirl', { start: 0, end: 5 }), frameRate: 8, repeat: -1 });
  anims.create({ key: 'ripple', frames: anims.generateFrameNumbers('ripple', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
  // 카피바라: 눈을 천천히 감았다 떴다
  anims.create({
    key: 'capyBath',
    frames: [
      { key: 'prop-capyBath', frame: 0, duration: 2600 },
      { key: 'prop-capyBath', frame: 1, duration: 300 },
      { key: 'prop-capyBath', frame: 2, duration: 3400 },
      { key: 'prop-capyBath', frame: 1, duration: 300 },
    ],
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: 'capyRest',
    frames: [
      { key: 'prop-capyRest', frame: 0, duration: 3200 },
      { key: 'prop-capyRest', frame: 1, duration: 2200 },
    ],
    frameRate: 10,
    repeat: -1,
  });
}

/** 캐릭터 시트를 필요할 때 생성 */
export function ensureCharacter(scene: Phaser.Scene, look: number): string {
  const key = characterKey(look);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.addCanvas(key, buildCharacterSheet(look))!;
  DIR_ROWS.forEach((dir, row) => {
    for (let c = 0; c < SHEET_COLS; c++) tex.add(`${dir}${c}`, 0, c * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
  });
  // 손 흔들기 / 춤
  scene.anims.create({ key: `${key}-wave`, frames: [{ key, frame: 'p1' }, { key, frame: 'p2' }], frameRate: 6, repeat: -1 });
  scene.anims.create({
    key: `${key}-dance`,
    frames: [
      { key, frame: 'p1' },
      { key, frame: 'd2' },
      { key, frame: 'p4' },
      { key, frame: 'd4' },
    ],
    frameRate: 5,
    repeat: -1,
  });
  for (const dir of ['d', 'u', 's'] as const) {
    scene.anims.create({
      key: `${key}-idle-${dir}`,
      frames: [
        { key, frame: `${dir}0`, duration: 2600 },
        { key, frame: `${dir}1`, duration: 40 },
      ],
      frameRate: 8,
      repeat: -1,
    });
    scene.anims.create({
      key: `${key}-walk-${dir}`,
      frames: [2, 3, 4, 5].map((i) => ({ key, frame: `${dir}${i}` })),
      frameRate: 9,
      repeat: -1,
    });
  }
  // 온천: 노곤한 표정으로 살짝 출렁
  scene.anims.create({
    key: `${key}-relax`,
    frames: [
      { key, frame: 'e2', duration: 900 },
      { key, frame: 'e5', duration: 900 },
    ],
    frameRate: 4,
    repeat: -1,
  });
  // 먹기: 냠 → 오물 반복
  scene.anims.create({
    key: `${key}-chew`,
    frames: [
      { key, frame: 'e3', duration: 120 },
      { key, frame: 'e4', duration: 160 },
    ],
    frameRate: 8,
    repeat: -1,
  });
  return key;
}

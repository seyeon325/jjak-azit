/** 코드로 그린 그림을 Phaser 텍스처/애니메이션으로 등록 */
import Phaser from 'phaser';
import { WORLD, type PropKind } from '../../../shared/map';
import { buildCharacterSheet, characterKey, DIR_ROWS, FRAME_H, FRAME_W, SHEET_COLS } from './art/characters';
import { bakeGround } from './art/ground';
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
    t.addCanvas(key, buildProp(p.kind as PropKind, p.label).canvas);
  }

  const flame = buildFlameSheet();
  addSheet(scene, 'flame', flame.canvas, flame.w, flame.h, flame.count);
  const swirl = buildSwirlSheet();
  addSheet(scene, 'swirl', swirl.canvas, swirl.w, swirl.h, swirl.count);
  t.addCanvas('glow', buildGlow(64));
  t.addCanvas('glowViolet', buildGlow(64, '190,160,255'));
  t.addCanvas('shadow', buildShadow());
  t.addCanvas('sparkle', buildSparkle());
  t.addCanvas('ember', buildDot('#ffc65a', 2));
  t.addCanvas('mote', buildDot('#fff6c8', 1));

  scene.anims.create({
    key: 'flame',
    frames: scene.anims.generateFrameNumbers('flame', { start: 0, end: 3 }),
    frameRate: 9,
    repeat: -1,
  });
  scene.anims.create({
    key: 'swirl',
    frames: scene.anims.generateFrameNumbers('swirl', { start: 0, end: 5 }),
    frameRate: 8,
    repeat: -1,
  });
}

/** 캐릭터 시트를 필요할 때 생성 (외형×색상 64조합 중 실제로 쓰이는 것만) */
export function ensureCharacter(scene: Phaser.Scene, look: number, color: number): string {
  const key = characterKey(look, color);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.addCanvas(key, buildCharacterSheet(look, color))!;
  DIR_ROWS.forEach((dir, row) => {
    for (let c = 0; c < SHEET_COLS; c++) tex.add(`${dir}${c}`, 0, c * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
  });
  for (const dir of DIR_ROWS) {
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
  return key;
}

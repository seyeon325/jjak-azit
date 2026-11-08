import Phaser from 'phaser';
import { WorldScene, type GameContext } from './scenes/WorldScene';

export function createGame(parent: HTMLElement, ctx: GameContext): { game: Phaser.Game; scene: () => WorldScene | null } {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#86c36a',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    fps: { target: 60 },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    banner: false,
    disableContextMenu: true,
    render: { powerPreference: 'high-performance', batchSize: 2048 },
  });
  game.scene.add('world', WorldScene, true, { ctx });
  // 화면 회전·주소창 변화 등으로 크기가 바뀌면 즉시 다시 맞춤
  const ro = new ResizeObserver(() => game.scale.refresh());
  ro.observe(parent);
  game.events.once(Phaser.Core.Events.DESTROY, () => ro.disconnect());
  return { game, scene: () => (game.scene.getScene('world') as WorldScene | null) ?? null };
}

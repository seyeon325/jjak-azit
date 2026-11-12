/**
 * 운영자 비밀번호 해시 만들기: npm run hashpw
 *  - 비밀번호를 입력하면 ADMIN_PASSWORD_HASH 에 넣을 값(scrypt$솔트$해시)을 출력합니다.
 *  - 비밀번호 원문은 어디에도 저장하지 않습니다. 출력된 해시 값만 호스팅(Render) 환경변수에 넣으세요.
 *  - 해시 값도 Git 저장소·공개 파일에는 적지 마세요.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
// 입력한 글자가 화면에 보이지 않도록
const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
let asking = false;
out._writeToOutput = (s: string) => {
  if (!asking) out.output.write(s);
};
process.stdout.write('운영자 비밀번호 입력 (화면에 표시되지 않아요): ');
asking = true;
rl.question('', (pw) => {
  asking = false;
  rl.close();
  process.stdout.write('\n');
  const value = pw.trim(); // 문자열 그대로 (앞자리 0 유지)
  if (!value) {
    console.log('비밀번호가 비어 있어요.');
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(value, salt, 32);
  console.log('\nRender → Environment 에 아래 이름과 값을 넣으세요:');
  console.log('  이름: ADMIN_PASSWORD_HASH');
  console.log(`  값:   scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
});

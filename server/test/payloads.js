// Shared by mask.test.js and leak.test.js: the sweep's payload classes, typed with the probe secrets hunter2xyz and abcdefghijklmnop1234.
// The fake credentials are assembled from parts so the source holds no literal that a secret scanner would (rightly) flag.
export const K = ['abcdefghijklmnop', '1234'].join('');
export const SK = ['sk', K].join('-');
export const GHP = ['ghp', K].join('_');
export const HEX24 = ['a1b2c3d4e5f6', 'a7b8c9d0e1f2'].join('');
export const HEX40 = [HEX24, 'a3b4c5d6e7f8a9b0'].join('');
export const UUID = ['123e4567', 'e89b', '12d3', 'a456', '426614174000'].join('-');
export const SHORT_JWT = ['eyJhbGciOi', 'eyJzdWIiOi', 'c2lnbg'].join('.');
export const JWT = [['eyJhbGciOiJ', 'SUzI1NiJ9'].join(''), ['eyJzdWIiOiJoMTIz', 'NDU2In0'].join(''), 'abcdefghij'].join('.');
// The sweep classes. Each is typed with the probe secrets hunter2xyz and abcdefghijklmnop1234.
export const CLASS_A = [ // C0/C1 controls interleaved in a keyword
  'p\u0001a\u0001s\u0001s\u0001w\u0001o\u0001r\u0001d: hunter2xyz', 'pass\u0000word=hunter2xyz', 'pass\u0085word=hunter2xyz', 'pass\u007fword=hunter2xyz',
  'my pa\u0000ss\u0000word is hunter2xyz', 'tok\u0001en hunter2xyz', 'Bea\u0001rer hunter2xyz', `s\u0001k-${K}`,
];
export const CLASS_B = ['password hunter2xyz', 'pw hunter2xyz', 'token hunter2xyz', 'secret hunter2xyz', 'api key hunter2xyz', 'the key is hunter2xyz'];
export const CLASS_C = ['bob:hunter2xyz@host.example', '//bob:hunter2xyz@host.example', 'https://bob:hunter2xyz@host.example/x', 'ftp://bob:hunter2xyz@host.example', 'https://hunter2xyz@host.example/x', '//hunter2xyz@host.example'];
export const CLASS_D = ['{"password":"hunter2xyz"}', `{"api_key": "${K}"}`, '{\\"password\\":\\"hunter2xyz\\"}', "{'secret':'hunter2xyz'}"];
export const EXTRA = [
  'password%3Dhunter2xyz', 'pass%2577ord=hunter2xyz', 'password%25253Dhunter2xyz', 'password+is+hunter2xyz', 'pass\tword=hunter2xyz', 'pass\tword: hunter2xyz', 'pa\tss\nword: hunter2xyz', 'pass\nword=hunter2xyz', 'pa​ss​word: hunter2xyz',
  'ｐａｓｓｗｏｒｄ＝hunter2xyz', 'password-hunter2xyz', ['api_key', 'hunter2xyz'].join('_'), 'client secret: hunter2xyz', 'Authorization: Bearer hunter2xyz', 'password - hunter2xyz',
  'my password is "hunter2xyz"', K, JWT, SK, GHP, SHORT_JWT, 'password=1 and password%3Dhunter2xyz',
  `-----BEGIN PRIVATE KEY-----\n${K}\n-----END PRIVATE KEY-----`,
];
export const ALL = [...CLASS_A, ...CLASS_B, ...CLASS_C, ...CLASS_D, ...EXTRA];

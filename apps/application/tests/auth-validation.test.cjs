const validation = require('../src/lib/auth-validation');

test('caps and formats phone input like the website', () => {
  expect(validation.formatPhoneOrEmailInput('123456788765434567898765434567')).toBe('(123)-456-7887');
  expect(validation.formatPhoneOrEmailInput('1234567')).toBe('(123)-456-7');
  expect(validation.formatPhoneOrEmailInput('person@example.com')).toBe('person@example.com');
});

test.each(['', '123', '12345678901234567890', 'not-an-email', 'user@', 'user@domain', '555/123/4567'])
('rejects invalid login identifier %p', value => {
  expect(() => validation.normalizeLoginIdentifier(value)).toThrow();
});

test('normalizes ten digit phones and email without modifying passwords', () => {
  expect(validation.normalizeLoginIdentifier('(519)-555-1234')).toBe('+15195551234');
  expect(validation.normalizeLoginIdentifier('+15195551234')).toBe('+15195551234');
  expect(validation.normalizeLoginIdentifier(' USER@Example.COM ')).toBe('user@example.com');
  expect(() => validation.validateLoginPassword('legacy')).not.toThrow();
  expect(() => validation.validateLoginPassword('')).toThrow('Please enter your password');
  expect(() => validation.validateLoginPassword('x'.repeat(129))).toThrow();
});

test('new passwords require the website policy and matching confirmation', () => {
  for (const password of ['short', 'abcdefgh', 'Abcd1234', '12345678!']) {
    expect(() => validation.validateNewPassword(password, password)).toThrow();
  }
  expect(() => validation.validateNewPassword('Abcd1234!', 'different')).toThrow('Passwords do not match');
  expect(() => validation.validateNewPassword('Abcd1234!', 'Abcd1234!')).not.toThrow();
});

test('validates profile name and numeric verification code', () => {
  expect(() => validation.normalizeFullName('1234')).toThrow();
  expect(() => validation.normalizeFullName('Ab')).toThrow();
  expect(validation.normalizeFullName(" Anne-Marie O'Neil ")).toBe("Anne-Marie O'Neil");
  expect(() => validation.validateOtp('123456')).not.toThrow();
  for (const code of ['12', '12a45', '1234567']) expect(() => validation.validateOtp(code)).toThrow();
});

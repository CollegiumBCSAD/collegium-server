import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const passwordErrors = async (password: string) => {
  const dto = plainToInstance(RegisterDto, {
    email: 'juan@umak.edu.ph',
    displayName: 'Juan',
    password,
  });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'password');
};

describe('RegisterDto password', () => {
  it('accepts 8+ characters with a letter and a number', async () => {
    expect(await passwordErrors('password1')).toHaveLength(0);
  });

  it.each([
    ['too short', 'pass1'],
    ['no number', 'passwordonly'],
    ['no letter', '12345678'],
    ['over 72 characters', 'a1'.repeat(37)],
  ])('rejects a password that is %s', async (_, password) => {
    expect(await passwordErrors(password)).toHaveLength(1);
  });
});

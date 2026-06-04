const { getMachineCode, deriveLicenseKey, validateLicenseKey } = require('../src/main/services/machineId');

describe('License & Login Validation (Desktop App)', () => {

  it('1. Should generate a valid format Machine Code', () => {
    const code = getMachineCode();
    expect(typeof code).toBe('string');
    // Machine code format: XXXX XXXX XXXX XXXX
    expect(code).toMatch(/^[A-F0-9]{4}\s[A-F0-9]{4}\s[A-F0-9]{4}\s[A-F0-9]{4}$/);
  });

  it('2. Should derive a deterministic License Key', () => {
    const fakeMachineCode = 'ABCD 1234 EFGH 5678';
    const key1 = deriveLicenseKey(fakeMachineCode);
    const key2 = deriveLicenseKey(fakeMachineCode);
    
    // License format: HL-XXXX-XXXX-XXXX
    expect(key1).toMatch(/^HL-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    
    // Deterministic check: Same machine code -> Same key
    expect(key1).toBe(key2);
  });

  it('3. Should validate correct License Key (Login Success)', async () => {
    // Tắt log đỏ của console.error khi không có môi trường Electron thật
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    const code = getMachineCode();
    const expectedKey = deriveLicenseKey(code);
    
    // Thử "đăng nhập" bằng key đúng
    const result = await validateLicenseKey(expectedKey);
    
    expect(result.valid).toBe(true);
    
    console.error.mockRestore();
  });

  it('4. Should reject wrong License Key (Login Failed)', async () => {
    // Thử "đăng nhập" bằng key sai
    const result = await validateLicenseKey('HL-WRONG-KEY-1234');
    
    expect(result.valid).toBe(false);
  });

});

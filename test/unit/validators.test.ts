import { describe, it, expect } from 'vitest';
import { validateRepoUrl, validateJobId, isValidJson } from '../../lambda/validators';

describe('validateRepoUrl', () => {
  describe('URLs válidas', () => {
    it('acepta https://github.com/facebook/react', () => {
      const result = validateRepoUrl('https://github.com/facebook/react');
      expect(result.valid).toBe(true);
      expect(result.owner).toBe('facebook');
      expect(result.repo).toBe('react');
    });

    it('acepta https://github.com/my-org/my-repo', () => {
      const result = validateRepoUrl('https://github.com/my-org/my-repo');
      expect(result.valid).toBe(true);
      expect(result.owner).toBe('my-org');
      expect(result.repo).toBe('my-repo');
    });
  });

  describe('URLs inválidas', () => {
    it('rechaza string vacío', () => {
      const result = validateRepoUrl('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza null', () => {
      const result = validateRepoUrl(null as unknown as string);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza otros dominios (gitlab)', () => {
      const result = validateRepoUrl('https://gitlab.com/foo/bar');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza URL sin owner ni repo (https://github.com/)', () => {
      const result = validateRepoUrl('https://github.com/');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza URL con solo owner (https://github.com/only-owner)', () => {
      const result = validateRepoUrl('https://github.com/only-owner');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza URL con segmentos extra (https://github.com/owner/repo/extra)', () => {
      const result = validateRepoUrl('https://github.com/owner/repo/extra');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza URL con .git suffix (https://github.com/owner/repo.git)', () => {
      const result = validateRepoUrl('https://github.com/owner/repo.git');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza URL con trailing slash (https://github.com/owner/repo/)', () => {
      const result = validateRepoUrl('https://github.com/owner/repo/');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza owner inválido que empieza con guión (https://github.com/-invalid/repo)', () => {
      const result = validateRepoUrl('https://github.com/-invalid/repo');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rechaza HTTP en vez de HTTPS (http://github.com/owner/repo)', () => {
      const result = validateRepoUrl('http://github.com/owner/repo');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('validateJobId', () => {
  describe('UUID v4 válidos', () => {
    it('acepta un UUID v4 válido', () => {
      expect(validateJobId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('acepta otro UUID v4 válido (lowercase)', () => {
      expect(validateJobId('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });
  });

  describe('UUID inválidos', () => {
    it('rechaza string vacío', () => {
      expect(validateJobId('')).toBe(false);
    });

    it('rechaza string aleatorio', () => {
      expect(validateJobId('not-a-uuid')).toBe(false);
    });

    it('rechaza UUID v1 (versión 1 en tercer grupo)', () => {
      expect(validateJobId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
    });
  });
});

describe('isValidJson', () => {
  describe('JSON válido', () => {
    it('acepta objeto vacío {}', () => {
      expect(isValidJson('{}')).toBe(true);
    });

    it('acepta objeto con propiedades', () => {
      expect(isValidJson('{"key":"value"}')).toBe(true);
    });

    it('acepta array vacío []', () => {
      expect(isValidJson('[]')).toBe(true);
    });

    it('acepta string JSON', () => {
      expect(isValidJson('"string"')).toBe(true);
    });
  });

  describe('JSON inválido', () => {
    it('rechaza string vacío', () => {
      expect(isValidJson('')).toBe(false);
    });

    it('rechaza null (cast)', () => {
      expect(isValidJson(null as unknown as string)).toBe(false);
    });

    it('rechaza texto no JSON', () => {
      expect(isValidJson('not json')).toBe(false);
    });

    it('rechaza JSON malformado', () => {
      expect(isValidJson('{invalid')).toBe(false);
    });
  });
});

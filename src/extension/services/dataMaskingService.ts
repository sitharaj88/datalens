import * as vscode from 'vscode';

export interface MaskingRule {
  pattern: string;
  maskFn: (value: unknown) => unknown;
}

export class DataMaskingService {
  private rules: MaskingRule[] = [];

  constructor() {
    this.refreshRules();
  }

  refreshRules(): void {
    const config = vscode.workspace.getConfiguration('dbViewer.dataMasking');
    const enabled = config.get<boolean>('enabled', false);

    if (!enabled) {
      this.rules = [];
      return;
    }

    const patterns = config.get<string[]>('patterns', ['email', 'password', 'ssn', 'credit_card', 'phone']);

    this.rules = patterns.map(pattern => ({
      pattern: pattern.toLowerCase(),
      maskFn: this.getMaskFunction(pattern.toLowerCase()),
    }));
  }

  isEnabled(): boolean {
    return this.rules.length > 0;
  }

  shouldMask(columnName: string): boolean {
    const lower = columnName.toLowerCase();
    return this.rules.some(rule => lower.includes(rule.pattern));
  }

  maskValue(columnName: string, value: unknown): unknown {
    if (value === null || value === undefined) return value;

    const lower = columnName.toLowerCase();
    const rule = this.rules.find(r => lower.includes(r.pattern));

    if (rule) {
      return rule.maskFn(value);
    }

    return value;
  }

  maskRow(row: Record<string, unknown>): Record<string, unknown> {
    if (!this.isEnabled()) return row;

    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      masked[key] = this.shouldMask(key) ? this.maskValue(key, value) : value;
    }
    return masked;
  }

  maskRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!this.isEnabled()) return rows;
    return rows.map(row => this.maskRow(row));
  }

  private getMaskFunction(pattern: string): (value: unknown) => unknown {
    switch (pattern) {
      case 'email':
        return (value) => {
          const str = String(value);
          const atIndex = str.indexOf('@');
          if (atIndex <= 0) return '***@***.***';
          return str[0] + '***' + str.substring(atIndex);
        };

      case 'password':
      case 'secret':
      case 'token':
      case 'api_key':
        return () => '********';

      case 'ssn':
        return (value) => {
          const str = String(value).replace(/\D/g, '');
          if (str.length >= 4) return '***-**-' + str.slice(-4);
          return '***-**-****';
        };

      case 'credit_card':
      case 'card_number':
        return (value) => {
          const str = String(value).replace(/\D/g, '');
          if (str.length >= 4) return '**** **** **** ' + str.slice(-4);
          return '**** **** **** ****';
        };

      case 'phone':
        return (value) => {
          const str = String(value).replace(/\D/g, '');
          if (str.length >= 4) return '***-***-' + str.slice(-4);
          return '***-***-****';
        };

      default:
        return (value) => {
          const str = String(value);
          if (str.length <= 2) return '**';
          return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
        };
    }
  }
}

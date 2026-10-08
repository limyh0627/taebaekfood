// @vitest-environment jsdom
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PayrollLineEditor from './PayrollLineEditor';
import type { PayrollLine } from '../../src/shared/types';
const line: PayrollLine = { employeeId: 'employee', employeeName: '합성 사원', base: 10000, incomeTax: 1000 };
describe('shared original payroll employee editor', () => {
  it('edits the selected employee field and recomputes gross, deduction and net without proportional allocation', () => {
    function Harness() {
      const [lines, setLines] = useState([line]);
      return <PayrollLineEditor lines={lines} onCell={(index, field, value) => setLines(rows => rows.map((row, i) =>
        i === index ? { ...row, [field]: Number(value.replace(/,/g, '')) } : row))} />;
    }
    render(<Harness />);
    const row = screen.getByText('합성 사원').closest('tr')!;
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: '12,000' } });
    expect(within(row).getAllByText('12,000').length).toBe(1);
    expect(within(row).getByText('11,000')).toBeTruthy();
    fireEvent.change(within(row).getAllByRole('textbox')[3], { target: { value: '2,000' } });
    expect(within(row).getByText('10,000')).toBeTruthy();
  });
  it('retains the existing payslip callback and employee snapshot', () => {
    const print = vi.fn();
    render(<PayrollLineEditor lines={[line]} onCell={vi.fn()} onPrint={print} />);
    fireEvent.click(screen.getByTitle('급여명세서'));
    expect(print).toHaveBeenCalledWith(line);
  });
});

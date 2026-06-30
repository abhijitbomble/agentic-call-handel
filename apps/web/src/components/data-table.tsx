import type { ReactNode } from "react";

type Column<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
};

type DataTableProps<Row extends { id: string }> = {
  rows: Row[];
  columns: Column<Row>[];
};

export function DataTable<Row extends { id: string }>({ rows, columns }: DataTableProps<Row>) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={`${row.id}-${column.key}`}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


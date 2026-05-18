jest.mock('../src/utils/db', () => ({ query: jest.fn() }));

const { query } = require('../src/utils/db');

function loadModule() {
  jest.resetModules();
  return require('../src/utils/employeeVisibility');
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('employeeVisibility', () => {
  test('builds a terminated-employee exclusion join when employees status columns exist', async () => {
    query.mockResolvedValueOnce({ rows: [
      { column_name: 'user_id' },
      { column_name: 'status' },
      { column_name: 'org_id' },
    ] });

    const { employeeVisibilitySql } = loadModule();
    const sql = await employeeVisibilitySql('u');

    expect(sql.join).toContain('LEFT JOIN employees e_visibility');
    expect(sql.join).toContain('e_visibility.user_id = u.id');
    expect(sql.join).toContain('e_visibility.org_id = u.org_id');
    expect(sql.condition).toContain("LOWER(COALESCE(e_visibility.status, 'active')) <> 'terminated'");
  });

  test('filters user ids through the non-terminated visibility condition', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { column_name: 'user_id' },
        { column_name: 'status' },
        { column_name: 'org_id' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'active-1' }, { id: 'active-2' }] });

    const { filterNonTerminatedUserIds } = loadModule();
    const ids = await filterNonTerminatedUserIds('org-1', ['active-1', 'terminated-1'], { requireActive: true });

    expect(ids).toEqual(['active-1', 'active-2']);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("LOWER(COALESCE(e_visibility.status, 'active')) <> 'terminated'"),
      ['org-1', ['active-1', 'terminated-1']]
    );
    expect(query.mock.calls[1][0]).toContain('COALESCE(u.is_active, TRUE) = TRUE');
    expect(query.mock.calls[1][0]).toContain('u.id = ANY($2)');
  });

  test('scopes managers to self plus subordinates before terminated filtering', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ user_id: 'sub-1' }, { user_id: 'sub-2' }] })
      .mockResolvedValueOnce({ rows: [
        { column_name: 'user_id' },
        { column_name: 'status' },
        { column_name: 'org_id' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'manager-1' }, { id: 'sub-1' }] });

    const { scopedNonTerminatedUserIds } = loadModule();
    const ids = await scopedNonTerminatedUserIds({ id: 'manager-1', org_id: 'org-1', role: 'manager' });

    expect(ids).toEqual(['manager-1', 'sub-1']);
    expect(query.mock.calls[2][1]).toEqual(['org-1', ['manager-1', 'sub-1', 'sub-2']]);
  });

  test('scopes org-wide roles to all non-terminated active users in the organization', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { column_name: 'user_id' },
        { column_name: 'status' },
        { column_name: 'org_id' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'admin-1' }, { id: 'employee-1' }] });

    const { scopedNonTerminatedUserIds } = loadModule();
    const ids = await scopedNonTerminatedUserIds({ id: 'admin-1', org_id: 'org-1', role: 'admin' });

    expect(ids).toEqual(['admin-1', 'employee-1']);
    expect(query.mock.calls[1][1]).toEqual(['org-1']);
    expect(query.mock.calls[1][0]).not.toContain('u.id = ANY');
    expect(query.mock.calls[1][0]).toContain("<> 'terminated'");
  });
});

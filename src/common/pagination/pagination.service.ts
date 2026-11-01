export function paginateResponse<T>(
  items: T[],
  total: number,
  page: number,
  perPage: number,
) {
  const lastPage = perPage > 0 ? Math.ceil(total / perPage) : 0;

  return {
    items,
    total,
    page,
    perPage,
    lastPage,
  };
}

export function paginateResponse<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number,
) {
  const totalPages = Math.ceil(total / perPage);

  return {
    data,
    pagination: {
      total,
      page,
      perPage,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

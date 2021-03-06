import * as agg from '../../src/agg';
import { Bool } from '../../src/expression';
import { SearchQuery } from '../../src/search';
import { OrderDoc, OrderSource, OrderStatus } from '../fixtures';

describe('Aggregations compile', () => {
  test('valid aggregations', () => {
    const searchQuery = new SearchQuery({});
    const query = searchQuery
      .source(false)
      .filter(
        Bool.must(
          OrderDoc.userId.in([1]),
          OrderDoc.status.in([OrderStatus.new, OrderStatus.handled, OrderStatus.paid]),
          OrderDoc.source.not(OrderSource.mobile),
        ),
      )
      .aggregations({
        usersOrders: new agg.Terms({
          field: OrderDoc.userId,
          size: 1,
          aggs: {
            total: new agg.Filter({
              filter: OrderDoc.conditionSourceDesktop(),
              aggs: {
                selled: new agg.Filter({
                  filter: Bool.must(
                    OrderDoc.status.in([OrderStatus.paid, OrderStatus.handled]),
                  ),
                  aggs: {
                    paid: new agg.Filter({
                      filter: OrderDoc.status.eq(OrderStatus.paid),
                    }),
                    handled: new agg.Filter({
                      filter: OrderDoc.status.eq(OrderStatus.handled),
                    }),
                  },
                }),
                canceled: new agg.Filter({
                  filter: OrderDoc.status.eq(OrderStatus.canceled),
                }),
                new: new agg.Filter({
                  filter: OrderDoc.status.eq(OrderStatus.new),
                }),
              },
            }),
            lowcost: new agg.Filter({
              filter: OrderDoc.conditionLowPrice(),
            }),
          },
        }),
      })
      .limit(0);
    expect(query.toJSON()).toStrictEqual({
      query: {
        bool: {
          filter: {
            bool: {
              must: [
                {
                  terms: {
                    user_id: [
                      1,
                    ],
                  },
                },
                {
                  terms: {
                    status: [
                      1,
                      3,
                      2, // order is a must
                    ],
                  },
                },
                {
                  bool: {
                    must_not: [
                      {
                        term: {
                          source: 2,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      _source: false,
      aggregations: {
        usersOrders: {
          terms: {
            field: 'user_id',
            size: 1,
          },
          aggregations: {
            total: {
              filter: {
                terms: {
                  source: [
                    1,
                  ],
                },
              },
              aggregations: {
                selled: {
                  filter: {
                    terms: {
                      status: [2, 3],
                    },
                  },
                  aggregations: {
                    paid: {
                      filter: {
                        term: {
                          status: 2,
                        },
                      },
                    },
                    handled: {
                      filter: {
                        term: {
                          status: 3,
                        },
                      },
                    },
                  },
                },
                canceled: {
                  filter: {
                    term: {
                      status: 4,
                    },
                  },
                },
                new: {
                  filter: {
                    term: {
                      status: 1,
                    },
                  },
                },
              },
            },
            lowcost: {
              filter: {
                range: {
                  price: {
                    lt: 10,
                  },
                },
              },
            },
          },
        },
      },
      size: 0,
    });
  });

  test('can clear aggs', () => {
    const searchQuery = new SearchQuery({});
    const query = searchQuery
      .aggregations({
        usersOrders: new agg.Terms({
          field: OrderDoc.userId,
          size: 1,
        }),
      });

    expect(query.toJSON()).toStrictEqual({
      aggregations: {
        usersOrders: {
          terms: {
            field: 'user_id',
            size: 1,
          },
        },
      },
    });

    query.aggs(null);
    expect(query.toJSON()).not.toHaveProperty('aggregations');
  });
});

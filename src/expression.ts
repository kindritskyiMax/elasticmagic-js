import { Field } from "./document";
import { cleanParams } from "./util";
import { Nullable } from "./types";

// TODO must be generic type with restrictions
export type TermValue = number | string | boolean;
export type TermField = {
  [field: string]: TermValue
}


// TODo this must be interface ???
export class Expression {
  public readonly _visitName: string = 'notDefined'; // TODO hack, is there some way to not init this fields ? interface ?
  public readonly _queryName: string = 'notDefined';
  public readonly _queryKey: string = 'notDefined';
}

export type ParamsType = {
  [key: string]: any; // TODO maybe some type
}; 


export type ParamKV = [string, any];

export class Params extends Expression {
  public _visitName = 'params';
  private params: ParamsType;
  private paramsKvList: Array<ParamKV>;

  constructor(params?: ParamsType) {
    super();
      this.params = cleanParams(params);
      this.paramsKvList = this.params ? Object.entries(this.params) : [];
  }

  public getParamsKvList(): Array<ParamKV> {
    return this.paramsKvList;
  }

  public getParams(): ParamsType {
    return this.params;
  }

  get length(): number {
    return this.paramsKvList.length;
  }

}

export class Literal extends Expression {
  public _visitName = 'literal';

  constructor(public obj: any) {
    super();
  }
}

export class ParamsExpression extends Expression {
  public params: Params;

  constructor(params: any) {
    super();
    this.params = new Params(params)
  }
}

export class QueryExpression extends ParamsExpression {
  public _visitName = 'queryExpression';
}

export class FieldExpression extends QueryExpression {
  public _visitName = 'fieldExpression';

  // TODO maybe later it will be Field but for now it Expression
  public field: Expression;

  // TODO field is an AttributeField, OrderedAttributes
  constructor(field: Field, params: any) {
    super(params); // TODO pass null or field ???
    this.field = this.wrapLiteral(field);
  }

  private wrapLiteral(field: Field): Expression {
    if (field instanceof Expression) {
      return field;
    }
    return new Literal(field)
  }
}

export class FieldQueryExpression extends FieldExpression {
  public _visitName = 'fieldQuery';
  public _queryKey = 'query';

  constructor(field: Field, public query: any) {
    super(field, null);
  }
}

export class Term extends FieldQueryExpression {
  public _visitName = 'term';
  public _queryName = 'term';
  public _queryKey = 'value';

  constructor(
    field: Field,
    term: TermValue
  ) {
    super(field, term);
  }
}

type TermsOptions = {
  mininum_should_match?: any;
  boost?: any;
}

export class Terms extends FieldExpression {
  public _visitName = 'terms';

  constructor(
    field: Field,
    public terms: TermValue[],
    termsOptions?: TermsOptions,
  ) {
    super(field, termsOptions);
  }
}

// TODO is type correct, for date?
export type RangeValue = number | string | Date;

type RangeOptions = {
  gte?: RangeValue;
  lte?: RangeValue;
  gt?: RangeValue;
  lt?: RangeValue;
  from?: RangeValue;
  to?: RangeValue;
  includeLower?: boolean;
  includeUpper?: boolean;
};

type RangeSettings = {
  execution?: any;
  name?: string;
  cache?: string;
  cacheKey?: string; // TOD maybe make kwargs
};

export class RangeExpr extends FieldExpression {
  public _visitName = 'range';
  public rangeParams: Params = new Params();

  constructor(
    field: Field,
    rangeOpts: RangeOptions,
    rangeSettings?: RangeSettings,
  ) {
    super(field, rangeOpts);
    this.rangeParams = new Params(rangeSettings)
  }
}

type BoolOptions = {
  must?: Nullable<Expression[]>;
  filter?: Nullable<Expression[]>;
  must_not?: Nullable<Expression[]>;
  should?: Nullable<Expression[]>;
  mininum_should_match?: any; // TODO finish this props
  boost?: any;
  disable_coord?: any;
};

export class Bool extends QueryExpression {
  public _queryName = 'bool';

  constructor(options: BoolOptions) {
    super(options);
  }

  // TODO make it clear what Expression to return
  public static must(...expressions: Expression[]): Expression {
    if (expressions.length === 1) {
      return expressions[0];
    }
    return new Bool({ must: expressions });
  }

  public static mustNot(...expressions: Expression[]): Bool {
    return new Bool({ must_not: expressions });
  } 

  public static should(...expressions: Expression[]): Expression {
    if (expressions.length === 1) {
      return expressions[0];
    }
    return new Bool({ should: expressions });
  } 
}


// TODO add Exists, Missing, Limit, Sort, Not, Ids, Script, Match, HasChild, HasParent
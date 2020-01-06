import { ParamsExpression, ParamsType, Params, Expression, ParamKV } from "./expression";
import { isObject } from "./util";
import { Field, FieldType, IDocument } from "./document";
import { KVList, Dictionary, RawAggBucket, RawAgg } from "./types";
import { InstanceMapper } from "./query";

type BucketKey = string | number;

class Bucket {
  // TODO figure out _typed_key

  public key: BucketKey;
  public docCount: number;
  public aggregations: Dictionary<string, AggResult> =  {};

  constructor(
    rawData: RawAggBucket,
    aggExpr: BucketAgg,
    private parent: AggResult, // TODO used by self.parent._populate_instances()
    docClsMap: Dictionary<string, IDocument>,
    mapperRegistry: any,
  ) {
    this.key = rawData.key; // TODO check if has property
    this.docCount = rawData.doc_count;

    aggExpr._aggregations.getParamsKvList().forEach((agg: ParamKV) => {
      const aggName: string = agg[0]
      const aggExpr: BucketAgg = agg[1];

      this.aggregations[aggName] = aggExpr.buildAggResult(
        rawData[aggName],
        docClsMap,
        mapperRegistry,
      );;
    });
  }

  public getAggregation(name: string): AggResult {
    return this.aggregations[name];
  }

  public toString(): string {
    return `${this.constructor.name}({ key: ${this.key}, docCount: ${this.docCount} })`;
  }
}


export class AggResult {
  public buckets: Bucket[] = [];
  public docCount: number = 0;
  constructor(public expr: BucketAgg) {}
}

export class AggExpression extends ParamsExpression {
  public _visitName = 'agg';
  public _aggName: any; // TODO hack so compiler sees this field for generic type

  public buildAggResult(_rawData: Dictionary<string, any>, _docClsMap: Dictionary<string, IDocument> = {}, _mapperRegistry: any = {}): AggResult {
    throw new Error('AggExpression: buildAggResult not implemented');
  }
}

export class BucketAgg extends AggExpression {
  public _visitName = 'bucketAgg';
  public _aggName: any; // TODO hack so compiler sees this field for generic type

  public _aggregations: Params;
  
  // TODO here must be interfact for resultClass, but in typescript it is hard to reason abount how to do this properly
  constructor(
    aggs?: Dictionary<string, Filter>, 
    params?: ParamsType, 
    // private resultClass?: any
  ) { 
    super(params);
    // TODO kwargs.pop('aggregations', {})
    this._aggregations = new Params(aggs);
  }

  // /**
  //  * TODO if we would know how to pass resultClass properly we can uncomment this method
  //  * but for now we are implementing buildAggResult in childs, its easier
  //  */
  // public buildAggResult(rawData: RawAggBucket, docClsMap: Dictionary<string, IDocument> = {}, mapperRegistry: any = {}): AggResult {
  //   return new this.resultClass(this, rawData, docClsMap, mapperRegistry);
  // }
}

function sortByKey(collection: object): Array<KVList<string>> {
  return Object.entries(collection).sort((a, b) => {
    const [keyA] = a;
    const [keyB] = b;
    return keyA.localeCompare(keyB);
  });
}

class SingleBucketAggResult extends AggResult {
  public docCount: number = 0;
  public aggregations: Dictionary<string, AggResult> = {};

  constructor(
    aggExpr: SingleBucketAgg, // TODO maybe later we will need to pass wider type
    rawData: RawAggBucket,
    docClsMap: Dictionary<string, IDocument>,
    mapperRegistry: any,
  ) {
    super(aggExpr);
    
    this.docCount = rawData.doc_count;

    aggExpr._aggregations.getParamsKvList().forEach((agg) => {
      const aggName: string = agg[0]
      const aggExpr: BucketAgg = agg[1];
      this.aggregations[aggName] = aggExpr.buildAggResult(
        rawData[aggName],
        docClsMap,
        mapperRegistry,
      );;
    });
  }

  public getAggregation(name: string): AggResult {
    return this.aggregations[name];
  }
}

export class MultiBucketAggResult extends AggResult {
  private bucketClass: any = Bucket // TODO add type
  public buckets: Bucket[] = [];
  private bucketsMap: Dictionary<string, Bucket> = {};
  private mapperRegistry: any = {}; // TODO add type

  constructor(
    aggExpr: MultiBucketAgg,
    rawData: RawAgg,
    docClsMap: Dictionary<string, IDocument>,
    mapperRegistry: any,
    private instanceMapper?: InstanceMapper<any, any>,
  ) {
    super(aggExpr);
    
    let rawBuckets = rawData.buckets || [];
    if (isObject(rawBuckets)) {
      const rawBucketsMap = rawBuckets;
      rawBuckets = sortByKey(rawBucketsMap).map(([key, rawBucket]) => {
        if (!('key' in rawBucket)) {
          rawBucket.key = key;
        }
        return rawBucket;
      });
    }

    rawBuckets.forEach((rawBucket: RawAggBucket) => {
      const bucket = new this.bucketClass(
        rawBucket,
        aggExpr,
        this,
        docClsMap,
        mapperRegistry,
      );
      this.addBucket(bucket);
    });

    if (mapperRegistry) {
      this.mapperRegistry = mapperRegistry;
    }

    if (this.instanceMapper) {
      // TOOD this piece of code is broken, as mapperRegistry must use sring as key, not instanceMapper itself
      if (!(this.instanceMapper as any in this.mapperRegistry)) {
        this.mapperRegistry[this.mapperRegistry] = [];
      }
      this.mapperRegistry[this.mapperRegistry].push(this);
    }
  }

  public addBucket(bucket: Bucket) {
    this.buckets.push(bucket);
    if (bucket.key) {
      this.bucketsMap[bucket.key] = bucket;
    }
  }

  public getBucket(key: BucketKey) {
    return this.bucketsMap[key];
  }

  // TODO def _populate_instances

}

export class SingleBucketAgg extends BucketAgg {
  public _aggName: any; // TODO hack so compiler sees this field for generic type

  constructor(
    aggs?: Dictionary<string, Filter>,
    params?: Dictionary<string, any>,
  ) {
    super(aggs, params);
  }

  // TODO in python we just pass result_cls and parent call buildAggResult
  // but for any reason we do not do this right now, maybe we will do this later
  public buildAggResult(rawData: RawAggBucket, docClsMap: Dictionary<string, IDocument> = {}, mapperRegistry: any = null): SingleBucketAggResult {
    return new SingleBucketAggResult(this, rawData, docClsMap, mapperRegistry);
  }
}

export class MultiBucketAgg extends BucketAgg {
  public _aggName: any; // TODO hack so compiler sees this field for generic type

  constructor(
    aggs?: Dictionary<string, Filter>,
    params?: TermsOptionsShrink, // TODO probably not appropriate type as MultiBucketAgg is parent class, replace with more generic
    private type?: FieldType, // TODO used by def clone
    protected instanceMapper?: InstanceMapper<any, any>,
  ) {
    super(aggs, params);
  }

  public buildAggResult(rawData: RawAgg, docClsMap: Dictionary<string, IDocument> = {}, mapperRegistry: any = null): MultiBucketAggResult {
    return new MultiBucketAggResult(this, rawData, docClsMap, mapperRegistry, this.instanceMapper);
  }
}

type TermsOptions = {
  field: Field;
  script?: any;
  size?: number;
  type?: FieldType;
  aggs?: Dictionary<string, Filter>;
  instanceMapper?: InstanceMapper<any, any>;
};

type TermsOptionsShrink = { // TODO not nice hack to differ types
  field?: Field;
  script?: any;
  size?: number;
};

function getType(field: Field, type?: FieldType): FieldType {
  return type || (field?.getType() ?? null);
};

export class Terms extends MultiBucketAgg {
  public _aggName = 'terms';

  constructor({ field, type, aggs, instanceMapper, ...opts }: TermsOptions) {
    super(
      aggs,
      { field, ...opts },
      getType(field, type),
      instanceMapper,
    );

    this.instanceMapper = instanceMapper;
  }
}

type FilterOptions = {
  filter: Expression;
  aggs?: Dictionary<string, Filter>;
};


export class Filter extends SingleBucketAgg {
  public _visitName = 'filterAgg';
  public _aggName = 'filter';

  public filter: Expression;
  constructor({ filter, aggs, ...opts }: FilterOptions) {
    super(aggs, opts);

    this.filter = filter;

  }
}
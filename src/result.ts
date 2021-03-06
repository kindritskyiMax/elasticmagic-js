import { AggResult, BucketAgg } from './agg';
import { Doc, DocClass } from './document';
import { ParamKV, Params } from './expression';
import { InstanceMapper } from './search';
import { Dictionary, Hit, RawResultBody } from './types';
import { arrayKVToDict } from './util';

const DOC_TYPE_FIELD = '_doc_type';
const DOC_TYPE_NAME_FIELD = `${DOC_TYPE_FIELD}.name`;

function docClsMap(
  docClasses: Readonly<DocClass[]>,
): Dictionary<string, DocClass> {
  return arrayKVToDict<Dictionary<string, DocClass>>(
    docClasses.map((cls) => [cls.docType, cls]),
  );
}

function getDocTypeForHit(hit: Hit): string {
  const fields = hit.fields || {};
  const customDocType = fields[DOC_TYPE_NAME_FIELD];
  return customDocType ? customDocType[0] : hit._type;
}

type InstanceMapperDict = Dictionary<string, InstanceMapper<any>>;

function isInstanceMapperDict(arg: any): arg is InstanceMapperDict {
  return arg.constructor.name === 'Object';
}

class Result {
  constructor(public raw: RawResultBody<any>) {}

  public get prettyRaw(): string {
    return JSON.stringify(this.raw, null, 2);
  }
}

export class SearchResult<T extends Doc = any> extends Result {

  private queryAggs: Params = new Params();
  private docClsMap: Dictionary<string, DocClass> = {};
  private instanceMappers: InstanceMapperDict = {};
  private mapperRegistry: any = {};

  public error: string | undefined;
  public took: number;
  public timedOut: boolean;
  public total: number;
  public maxScore: number;
  public hits: T[] = [];
  public aggregations: Dictionary<string, any> = {};
  public scrollId: number | undefined;

  constructor(
    rawResult: RawResultBody<any>,
    aggregations: Params,
    private docClasses: Readonly<DocClass[]>,
    instanceMapper?: InstanceMapper<any> | InstanceMapperDict, // TODO pass types
  ) {
    super(rawResult);

    this.queryAggs = aggregations || new Params();
    this.docClsMap = docClsMap(docClasses);

    if (instanceMapper) {
      // TODO although we can check if instanceMapper is a dict
      // it is not implemented to accept instanceMapper at a higher level yet
      if (isInstanceMapperDict(instanceMapper)) {
        this.instanceMappers = instanceMapper;
      } else {
        this.instanceMappers = arrayKVToDict<InstanceMapperDict>(
          this.docClasses.map((cls) => [cls.docType, instanceMapper]),
        );
      }
    }
    this.error = rawResult.error;
    this.took = rawResult.took;
    this.timedOut = rawResult.timed_out;

    const hits = rawResult.hits || {};
    this.total = hits.total;
    this.maxScore = hits.max_score;
    hits.hits.forEach((hit: Hit) => {
      const docType = getDocTypeForHit(hit);
      // TODO below use some sort of DynamicDocument, because fail if no docClass passed to SearchResult
      const docCls = this.docClsMap[docType];

      // TODO below is a hack
      // the propblem is when having class type to create instance from it we need to know its type
      // but we have only interface
      // The solution unknown by now
      this.hits.push(new docCls({ hit, result: this, docType: docCls.docType }) as T);
    });

    this.queryAggs.getParamsKvList().forEach((agg: ParamKV) => {
      const aggName: string = agg[0];
      const aggExpr: BucketAgg = agg[1];

      const rawAggData = (rawResult.aggregations || {})[aggName];
      this.aggregations[aggName] = aggExpr.buildAggResult(
        rawAggData,
        this.docClsMap,
        this.mapperRegistry,
      );
    });

    this.scrollId = rawResult._scroll_id;
  }

  public getAggregation(name: string): AggResult {
    return this.aggregations[name];
  }

  public getIds(): string[] {
    return this.hits.map((hit) => hit._id);
  }

  /**
   * Populates docs (hits) with result of instance mapper.
   */
  public async populateInstances(docType?: string) {
    const getHitIds = (docs: Doc[]): string[] => {
      return docs.map((doc) => doc._id);
    };

    let instancesMap: Map<string, Doc> = new Map();

    if (docType) {
      const mapper = this.instanceMappers[docType];
      if (!mapper) {
        throw new Error(`no instance mapper for ${docType} doc type`);
      }
      instancesMap = await mapper(getHitIds(this.hits));
    } else {
      const docTypeDocsMap = this.getDocTypeDocMap();
      docTypeDocsMap.forEach(async (docs, key) => {
        const mapper = this.instanceMappers[key];
        if (!mapper) {
          throw new Error(`no instance mapper for ${key} doc type`);
        }
        const mapped = await mapper(getHitIds(docs));
        instancesMap = new Map([...instancesMap, ...mapped]);
      });
    }
    this.hits.forEach((hit) => {
      hit.setInstance(instancesMap.get(hit._id));
    });
  }

  private getDocTypeDocMap(): Map<string, Doc[]> {
    const docTypeDocsMap = new Map();
    this.hits.forEach((hit) => {
      const key = hit.docType;
      if (docTypeDocsMap.get(key) === undefined) {
        docTypeDocsMap.set(key, []);
      }
      docTypeDocsMap.get(key).push(hit);
    });
    return docTypeDocsMap;
  }

  public async getInstances<Inst = any>(): Promise<Inst[]> {
    await this.populateInstances();
    return Promise.all(this.hits.map(async (hit) => await hit.getInstance()));
  }
}

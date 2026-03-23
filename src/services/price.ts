import axios, { AxiosRequestConfig } from 'axios';
import { AssetType } from '../types';
import { proxyConfig } from '../config';

function applyProxy(config: AxiosRequestConfig): AxiosRequestConfig {
  if (proxyConfig.enabled) {
    config.proxy = { host: proxyConfig.host, port: proxyConfig.port, protocol: 'http' };
  }
  return config;
}

async function requestWithRetry<T>(config: AxiosRequestConfig, retries = 3, delay = 2000): Promise<T> {
  applyProxy(config);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response.data as T;
    } catch (error: any) {
      const isLast = attempt === retries;
      if (isLast) throw error;
      const isRetryable = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
        || error.code === 'ECONNRESET' || error.code === 'EPROTO'
        || !error.response || error.response.status >= 500 || error.response.status === 451;
      if (!isRetryable) throw error;
      console.warn(`⚠️ 请求失败 (${attempt}/${retries})，${delay / 1000}s 后重试...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('请求失败');
}

// 价格数据提供者接口
export interface PriceProvider {
  getPrice(symbol: string): Promise<number>;
  validateSymbol(symbol: string): Promise<boolean>;
  searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>>;
}

// 加密货币 - OKX 优先，Binance 备用
class CryptoProvider implements PriceProvider {
  private readonly commonCryptos = [
    { symbol: 'BTCUSDT', name: 'Bitcoin/USDT' },
    { symbol: 'ETHUSDT', name: 'Ethereum/USDT' },
    { symbol: 'BNBUSDT', name: 'BNB/USDT' },
    { symbol: 'SOLUSDT', name: 'Solana/USDT' },
    { symbol: 'XRPUSDT', name: 'Ripple/USDT' },
    { symbol: 'ADAUSDT', name: 'Cardano/USDT' },
    { symbol: 'DOGEUSDT', name: 'Dogecoin/USDT' },
    { symbol: 'MATICUSDT', name: 'Polygon/USDT' },
    { symbol: 'DOTUSDT', name: 'Polkadot/USDT' },
    { symbol: 'LTCUSDT', name: 'Litecoin/USDT' },
    { symbol: 'AVAXUSDT', name: 'Avalanche/USDT' },
    { symbol: 'LINKUSDT', name: 'Chainlink/USDT' },
    { symbol: 'ATOMUSDT', name: 'Cosmos/USDT' },
    { symbol: 'UNIUSDT', name: 'Uniswap/USDT' },
    { symbol: 'ETCUSDT', name: 'Ethereum Classic/USDT' },
    { symbol: 'XLMUSDT', name: 'Stellar/USDT' },
    { symbol: 'ALGOUSDT', name: 'Algorand/USDT' },
    { symbol: 'VETUSDT', name: 'VeChain/USDT' },
    { symbol: 'FILUSDT', name: 'Filecoin/USDT' },
    { symbol: 'TRXUSDT', name: 'TRON/USDT' }
  ];

  private toOkxInstId(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.endsWith('USDT')) return s.replace('USDT', '-USDT');
    if (s.endsWith('USDC')) return s.replace('USDC', '-USDC');
    if (s.endsWith('BTC')) return s.replace('BTC', '-BTC');
    return s + '-USDT';
  }

  async getPrice(symbol: string): Promise<number> {
    // OKX (国内直连)
    try {
      const instId = this.toOkxInstId(symbol);
      const data = await requestWithRetry<any>({
        url: 'https://www.okx.com/api/v5/market/ticker',
        params: { instId },
        timeout: 15000
      }, 2, 1000);
      if (data?.data?.[0]?.last) return parseFloat(data.data[0].last);
    } catch (e: any) {
      console.warn(`OKX 获取失败，尝试 Binance: ${e.message}`);
    }

    // Binance 备用
    const data = await requestWithRetry<{ price: string }>({
      url: 'https://api.binance.com/api/v3/ticker/price',
      params: { symbol },
      timeout: 15000
    });
    return parseFloat(data.price);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return this.commonCryptos.some(c => c.symbol === symbol);
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const q = query.toLowerCase();

    try {
      const data = await requestWithRetry<any>({
        url: 'https://www.okx.com/api/v5/market/tickers',
        params: { instType: 'SPOT' },
        timeout: 15000
      }, 2, 1000);

      if (data?.data) {
        const results = data.data
          .filter((t: any) => t.instId.toLowerCase().includes(q))
          .slice(0, 20)
          .map((t: any) => {
            const [base, quote] = t.instId.split('-');
            return { symbol: base + quote, name: `${base}/${quote}` };
          });
        if (results.length > 0) return results;
      }
    } catch {
      console.log('OKX API 搜索不可用，使用本地列表');
    }

    return this.commonCryptos.filter(c =>
      c.symbol.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    );
  }
}

// Yahoo Finance API - 股票（支持中文搜索）
class YahooFinanceProvider implements PriceProvider {
  private readonly cnStocks: Array<{ symbol: string; name: string; pinyin: string }> = [
    // ======== A股·上证 (600/601/603/688) ========
    // 白酒
    { symbol: '600519.SS', name: '贵州茅台', pinyin: 'guizhou maotai' },
    { symbol: '600809.SS', name: '山西汾酒', pinyin: 'shanxi fenjiu' },
    { symbol: '603369.SS', name: '今世缘', pinyin: 'jinshiyuan' },
    { symbol: '600779.SS', name: '水井坊', pinyin: 'shuijingfang' },
    { symbol: '600702.SS', name: '舍得酒业', pinyin: 'shede jiuye' },
    { symbol: '603589.SS', name: '口子窖', pinyin: 'kouzijiao' },
    { symbol: '603198.SS', name: '迎驾贡酒', pinyin: 'yingjia gongjiu' },
    { symbol: '600600.SS', name: '青岛啤酒', pinyin: 'qingdao pijiu' },
    // 银行
    { symbol: '601398.SS', name: '工商银行', pinyin: 'gongshang yinhang icbc' },
    { symbol: '601939.SS', name: '建设银行', pinyin: 'jianshe yinhang ccb' },
    { symbol: '601288.SS', name: '农业银行', pinyin: 'nongye yinhang abc' },
    { symbol: '601988.SS', name: '中国银行', pinyin: 'zhongguo yinhang boc' },
    { symbol: '600036.SS', name: '招商银行', pinyin: 'zhaoshang yinhang cmb' },
    { symbol: '601166.SS', name: '兴业银行', pinyin: 'xingye yinhang cib' },
    { symbol: '600000.SS', name: '浦发银行', pinyin: 'pufa yinhang spdb' },
    { symbol: '601328.SS', name: '交通银行', pinyin: 'jiaotong yinhang bocom' },
    { symbol: '601658.SS', name: '邮储银行', pinyin: 'youchu yinhang psbc' },
    { symbol: '601998.SS', name: '中信银行', pinyin: 'zhongxin yinhang citic' },
    { symbol: '601818.SS', name: '光大银行', pinyin: 'guangda yinhang ceb' },
    { symbol: '600016.SS', name: '民生银行', pinyin: 'minsheng yinhang cmbc' },
    { symbol: '601169.SS', name: '北京银行', pinyin: 'beijing yinhang' },
    { symbol: '601009.SS', name: '南京银行', pinyin: 'nanjing yinhang' },
    { symbol: '600926.SS', name: '杭州银行', pinyin: 'hangzhou yinhang' },
    { symbol: '601838.SS', name: '成都银行', pinyin: 'chengdu yinhang' },
    // 保险
    { symbol: '601318.SS', name: '中国平安', pinyin: 'zhongguo pingan' },
    { symbol: '601601.SS', name: '中国太保', pinyin: 'zhongguo taibao cpic' },
    { symbol: '601628.SS', name: '中国人寿', pinyin: 'zhongguo renshou' },
    { symbol: '601319.SS', name: '中国人保', pinyin: 'zhongguo renbao picc' },
    { symbol: '601336.SS', name: '新华保险', pinyin: 'xinhua baoxian' },
    // 证券
    { symbol: '600030.SS', name: '中信证券', pinyin: 'zhongxin zhengquan' },
    { symbol: '601688.SS', name: '华泰证券', pinyin: 'huatai zhengquan' },
    { symbol: '601211.SS', name: '国泰君安', pinyin: 'guotai junan' },
    { symbol: '600837.SS', name: '海通证券', pinyin: 'haitong zhengquan' },
    { symbol: '600958.SS', name: '东方证券', pinyin: 'dongfang zhengquan' },
    { symbol: '600999.SS', name: '招商证券', pinyin: 'zhaoshang zhengquan' },
    { symbol: '601995.SS', name: '中金公司', pinyin: 'zhongjin gongsi cicc' },
    // 能源·资源
    { symbol: '601857.SS', name: '中国石油', pinyin: 'zhongguo shiyou petrochina' },
    { symbol: '600028.SS', name: '中国石化', pinyin: 'zhongguo shihua sinopec' },
    { symbol: '601088.SS', name: '中国神华', pinyin: 'zhongguo shenhua' },
    { symbol: '600938.SS', name: '中国海油', pinyin: 'zhongguo haiyou cnooc' },
    { symbol: '600188.SS', name: '兖矿能源', pinyin: 'yankuang nengyuan' },
    { symbol: '601225.SS', name: '陕西煤业', pinyin: 'shanxi meiye' },
    { symbol: '601899.SS', name: '紫金矿业', pinyin: 'zijin kuangye' },
    { symbol: '600111.SS', name: '北方稀土', pinyin: 'beifang xitu' },
    { symbol: '601600.SS', name: '中国铝业', pinyin: 'zhongguo lvye chalco' },
    { symbol: '603993.SS', name: '洛阳钼业', pinyin: 'luoyang muye cmoc' },
    { symbol: '603799.SS', name: '华友钴业', pinyin: 'huayou guye' },
    // 电力·公用
    { symbol: '600900.SS', name: '长江电力', pinyin: 'changjiang dianli' },
    { symbol: '600905.SS', name: '三峡能源', pinyin: 'sanxia nengyuan' },
    { symbol: '601985.SS', name: '中国核电', pinyin: 'zhongguo hedian cnnp' },
    { symbol: '600886.SS', name: '国投电力', pinyin: 'guotou dianli' },
    // 电信
    { symbol: '600941.SS', name: '中国移动', pinyin: 'zhongguo yidong a' },
    { symbol: '600050.SS', name: '中国联通', pinyin: 'zhongguo liantong' },
    { symbol: '601728.SS', name: '中国电信', pinyin: 'zhongguo dianxin' },
    // 建筑·基建
    { symbol: '601668.SS', name: '中国建筑', pinyin: 'zhongguo jianzhu' },
    { symbol: '601186.SS', name: '中国铁建', pinyin: 'zhongguo tiejian crcc' },
    { symbol: '601390.SS', name: '中国中铁', pinyin: 'zhongguo zhongtie crec' },
    { symbol: '601800.SS', name: '中国交建', pinyin: 'zhongguo jiaojian cccc' },
    { symbol: '600048.SS', name: '保利发展', pinyin: 'baoli fazhan' },
    { symbol: '600585.SS', name: '海螺水泥', pinyin: 'hailuo shuini conch' },
    // 汽车
    { symbol: '600104.SS', name: '上汽集团', pinyin: 'shangqi jituan saic' },
    { symbol: '601633.SS', name: '长城汽车', pinyin: 'changcheng qiche gwm' },
    { symbol: '601238.SS', name: '广汽集团', pinyin: 'guangqi jituan gac' },
    { symbol: '601127.SS', name: '赛力斯', pinyin: 'sailisi seres' },
    // 医药
    { symbol: '600276.SS', name: '恒瑞医药', pinyin: 'hengrui yiyao' },
    { symbol: '603259.SS', name: '药明康德', pinyin: 'yaoming kangde wuxi' },
    { symbol: '600436.SS', name: '片仔癀', pinyin: 'pian zai huang' },
    { symbol: '600196.SS', name: '复星医药', pinyin: 'fuxing yiyao fosun' },
    { symbol: '600085.SS', name: '同仁堂', pinyin: 'tongrentang' },
    { symbol: '600763.SS', name: '通策医疗', pinyin: 'tongce yiliao' },
    // 消费
    { symbol: '600887.SS', name: '伊利股份', pinyin: 'yili gufen' },
    { symbol: '603288.SS', name: '海天味业', pinyin: 'haitian weiye' },
    { symbol: '600690.SS', name: '海尔智家', pinyin: 'haier zhijia' },
    { symbol: '601888.SS', name: '中国中免', pinyin: 'zhongguo zhongmian cdfg' },
    // 制造·工业
    { symbol: '600031.SS', name: '三一重工', pinyin: 'sanyi zhonggong sany' },
    { symbol: '600309.SS', name: '万华化学', pinyin: 'wanhua huaxue' },
    { symbol: '600438.SS', name: '通威股份', pinyin: 'tongwei gufen' },
    // 新能源
    { symbol: '601012.SS', name: '隆基绿能', pinyin: 'longji lvneng longi' },
    { symbol: '688599.SS', name: '天合光能', pinyin: 'tianhe guangneng trinasolar' },
    { symbol: '688223.SS', name: '晶科能源', pinyin: 'jingke nengyuan jinkosolar' },
    // 半导体·科技
    { symbol: '688012.SS', name: '中微公司', pinyin: 'zhongwei gongsi amec' },
    { symbol: '688036.SS', name: '传音控股', pinyin: 'chuanyin konggu transsion' },
    { symbol: '603501.SS', name: '韦尔股份', pinyin: 'weier gufen will' },
    { symbol: '600745.SS', name: '闻泰科技', pinyin: 'wentai keji wingtech' },
    { symbol: '600703.SS', name: '三安光电', pinyin: 'sanan guangdian' },
    { symbol: '603986.SS', name: '兆易创新', pinyin: 'zhaoyi chuangxin gigadevice' },
    { symbol: '688111.SS', name: '金山办公', pinyin: 'jinshan bangong wps kingsoft' },
    { symbol: '600588.SS', name: '用友网络', pinyin: 'yongyou wangluo' },
    // 军工
    { symbol: '600760.SS', name: '中航沈飞', pinyin: 'zhonghang shenfei avic' },
    { symbol: '600893.SS', name: '航发动力', pinyin: 'hangfa dongli aecc' },
    // 交运·物流
    { symbol: '601919.SS', name: '中远海控', pinyin: 'zhongyuan haikong cosco' },
    { symbol: '601111.SS', name: '中国国航', pinyin: 'zhongguo guohang airchina' },
    { symbol: '600029.SS', name: '南方航空', pinyin: 'nanfang hangkong csair' },
    { symbol: '600233.SS', name: '圆通速递', pinyin: 'yuantong sudi yto' },
    // 传媒
    { symbol: '600588.SS', name: '用友网络', pinyin: 'yongyou wangluo' },

    // ======== A股·深证 (000/002/300) ========
    // 白酒
    { symbol: '000858.SZ', name: '五粮液', pinyin: 'wuliangye' },
    { symbol: '000568.SZ', name: '泸州老窖', pinyin: 'luzhou laojiao' },
    { symbol: '002304.SZ', name: '洋河股份', pinyin: 'yanghe gufen' },
    { symbol: '000596.SZ', name: '古井贡酒', pinyin: 'gujing gongjiu' },
    // 银行
    { symbol: '000001.SZ', name: '平安银行', pinyin: 'pingan yinhang' },
    { symbol: '002142.SZ', name: '宁波银行', pinyin: 'ningbo yinhang' },
    // 证券
    { symbol: '000776.SZ', name: '广发证券', pinyin: 'guangfa zhengquan gf' },
    // 家电·消费
    { symbol: '000333.SZ', name: '美的集团', pinyin: 'meidi jituan midea' },
    { symbol: '000651.SZ', name: '格力电器', pinyin: 'geli dianqi gree' },
    { symbol: '000895.SZ', name: '双汇发展', pinyin: 'shuanghui fazhan' },
    { symbol: '000725.SZ', name: '京东方A', pinyin: 'jingdongfang boe' },
    { symbol: '000002.SZ', name: '万科A', pinyin: 'wanke vanke' },
    // 汽车·新能源车
    { symbol: '002594.SZ', name: '比亚迪', pinyin: 'biyadi byd' },
    { symbol: '000625.SZ', name: '长安汽车', pinyin: 'changan qiche' },
    // 科技·半导体
    { symbol: '002415.SZ', name: '海康威视', pinyin: 'haikang weishi hikvision' },
    { symbol: '002230.SZ', name: '科大讯飞', pinyin: 'keda xunfei iflytek' },
    { symbol: '002475.SZ', name: '立讯精密', pinyin: 'lixun jingmi luxshare' },
    { symbol: '002241.SZ', name: '歌尔股份', pinyin: 'goer gufen' },
    { symbol: '000063.SZ', name: '中兴通讯', pinyin: 'zhongxing tongxun zte' },
    { symbol: '002371.SZ', name: '北方华创', pinyin: 'beifang huachuang naura' },
    { symbol: '000100.SZ', name: 'TCL科技', pinyin: 'tcl keji' },
    { symbol: '002049.SZ', name: '紫光国微', pinyin: 'ziguang guowei unisoc' },
    { symbol: '002236.SZ', name: '大华股份', pinyin: 'dahua gufen dahua' },
    { symbol: '002179.SZ', name: '中航光电', pinyin: 'zhonghang guangdian jonhon' },
    // 医药
    { symbol: '000538.SZ', name: '云南白药', pinyin: 'yunnan baiyao' },
    { symbol: '000661.SZ', name: '长春高新', pinyin: 'changchun gaoxin' },
    { symbol: '000963.SZ', name: '华东医药', pinyin: 'huadong yiyao' },
    { symbol: '002007.SZ', name: '华兰生物', pinyin: 'hualan shengwu' },
    // 新能源
    { symbol: '300750.SZ', name: '宁德时代', pinyin: 'ningde shidai catl' },
    { symbol: '300274.SZ', name: '阳光电源', pinyin: 'yangguang dianyuan sungrow' },
    { symbol: '300014.SZ', name: '亿纬锂能', pinyin: 'yiwei lineng eve' },
    { symbol: '002466.SZ', name: '天齐锂业', pinyin: 'tianqi liye' },
    { symbol: '002460.SZ', name: '赣锋锂业', pinyin: 'ganfeng liye ganfeng' },
    { symbol: '002459.SZ', name: '晶澳科技', pinyin: 'jingao keji jasolar' },
    // 创业板·科技
    { symbol: '300059.SZ', name: '东方财富', pinyin: 'dongfang caifu eastmoney' },
    { symbol: '300124.SZ', name: '汇川技术', pinyin: 'huichuan jishu inovance' },
    { symbol: '300015.SZ', name: '爱尔眼科', pinyin: 'aier yanke' },
    { symbol: '300760.SZ', name: '迈瑞医疗', pinyin: 'mairui yiliao mindray' },
    { symbol: '300122.SZ', name: '智飞生物', pinyin: 'zhifei shengwu' },
    { symbol: '300347.SZ', name: '泰格医药', pinyin: 'taige yiyao tigermed' },
    { symbol: '300759.SZ', name: '康龙化成', pinyin: 'kanglong huacheng pharmaron' },
    { symbol: '300999.SZ', name: '金龙鱼', pinyin: 'jinlongyu' },
    { symbol: '300413.SZ', name: '芒果超媒', pinyin: 'mangguo chaomei mango' },
    // 农牧·食品
    { symbol: '002714.SZ', name: '牧原股份', pinyin: 'muyuan gufen' },
    // 物流
    { symbol: '002352.SZ', name: '顺丰控股', pinyin: 'shunfeng konggu sf' },
    { symbol: '002120.SZ', name: '韵达股份', pinyin: 'yunda gufen' },
    // 地产·物业
    { symbol: '001979.SZ', name: '招商蛇口', pinyin: 'zhaoshang shekou cmsk' },
    // 军工
    { symbol: '000768.SZ', name: '中航西飞', pinyin: 'zhonghang xifei avic' },
    // 传媒
    { symbol: '002027.SZ', name: '分众传媒', pinyin: 'fenzhong chuanmei focus' },

    // ======== 港股 ========
    // 互联网·科技
    { symbol: '0700.HK', name: '腾讯控股', pinyin: 'tengxun konggu tencent' },
    { symbol: '9988.HK', name: '阿里巴巴-W', pinyin: 'alibaba' },
    { symbol: '3690.HK', name: '美团-W', pinyin: 'meituan' },
    { symbol: '9999.HK', name: '网易-S', pinyin: 'wangyi netease' },
    { symbol: '1810.HK', name: '小米集团-W', pinyin: 'xiaomi jituan' },
    { symbol: '9618.HK', name: '京东集团-SW', pinyin: 'jingdong jituan' },
    { symbol: '9888.HK', name: '百度集团-SW', pinyin: 'baidu jituan' },
    { symbol: '1024.HK', name: '快手-W', pinyin: 'kuaishou' },
    { symbol: '0268.HK', name: '金蝶国际', pinyin: 'jindie guoji kingdee' },
    { symbol: '2382.HK', name: '舜宇光学科技', pinyin: 'shunyu guangxue sunny' },
    { symbol: '0992.HK', name: '联想集团', pinyin: 'lianxiang jituan lenovo' },
    { symbol: '0020.HK', name: '商汤-W', pinyin: 'shangtang sensetime' },
    // 汽车
    { symbol: '1211.HK', name: '比亚迪股份', pinyin: 'biyadi gufen byd' },
    { symbol: '0175.HK', name: '吉利汽车', pinyin: 'jili qiche geely' },
    { symbol: '2015.HK', name: '理想汽车-W', pinyin: 'lixiang qiche li auto' },
    { symbol: '9866.HK', name: '蔚来-SW', pinyin: 'weilai nio' },
    { symbol: '9868.HK', name: '小鹏汽车-W', pinyin: 'xiaopeng qiche xpeng' },
    { symbol: '2333.HK', name: '长城汽车', pinyin: 'changcheng qiche gwm' },
    // 金融
    { symbol: '2318.HK', name: '中国平安', pinyin: 'zhongguo pingan' },
    { symbol: '0005.HK', name: '汇丰控股', pinyin: 'huifeng konggu hsbc' },
    { symbol: '1299.HK', name: '友邦保险', pinyin: 'youbang baoxian aia' },
    { symbol: '0388.HK', name: '香港交易所', pinyin: 'xianggang jiaoyisuo hkex' },
    { symbol: '0966.HK', name: '中国太平', pinyin: 'zhongguo taiping' },
    { symbol: '1398.HK', name: '工商银行(港)', pinyin: 'gongshang yinhang hk' },
    { symbol: '3988.HK', name: '中国银行(港)', pinyin: 'zhongguo yinhang hk' },
    { symbol: '0939.HK', name: '建设银行(港)', pinyin: 'jianshe yinhang hk' },
    // 电信·能源
    { symbol: '0941.HK', name: '中国移动', pinyin: 'zhongguo yidong' },
    { symbol: '0728.HK', name: '中国电信(港)', pinyin: 'zhongguo dianxin hk' },
    { symbol: '0883.HK', name: '中国海洋石油', pinyin: 'zhongguo haiyang shiyou cnooc' },
    // 消费·零售
    { symbol: '2020.HK', name: '安踏体育', pinyin: 'anta tiyu' },
    { symbol: '2331.HK', name: '李宁', pinyin: 'lining' },
    { symbol: '9633.HK', name: '农夫山泉', pinyin: 'nongfu shanquan' },
    { symbol: '0291.HK', name: '华润啤酒', pinyin: 'huarun pijiu cr beer' },
    { symbol: '2319.HK', name: '蒙牛乳业', pinyin: 'mengniu ruye' },
    { symbol: '6186.HK', name: '中国飞鹤', pinyin: 'zhongguo feihe' },
    { symbol: '9992.HK', name: '泡泡玛特', pinyin: 'paopao mate popmart' },
    { symbol: '6862.HK', name: '海底捞', pinyin: 'haidilao' },
    // 医药
    { symbol: '2269.HK', name: '药明生物', pinyin: 'yaoming shengwu wuxi bio' },
    { symbol: '1093.HK', name: '石药集团', pinyin: 'shiyao jituan cspc' },
    { symbol: '1177.HK', name: '中国生物制药', pinyin: 'zhongguo shengwu zhiyao sino biopharma' },
    // 半导体
    { symbol: '0981.HK', name: '中芯国际', pinyin: 'zhongxin guoji smic' },
    // 工业·建材
    { symbol: '1766.HK', name: '中国中车', pinyin: 'zhongguo zhongche crrc' },
    { symbol: '3323.HK', name: '中国建材', pinyin: 'zhongguo jiancai cnbm' },
    // 地产·物业
    { symbol: '1109.HK', name: '华润置地', pinyin: 'huarun zhidi cr land' },
    { symbol: '1209.HK', name: '华润万象生活', pinyin: 'huarun wanxiang shenghuo cr mixc' },

    // ======== 美股·中概股 ========
    { symbol: 'BABA', name: '阿里巴巴(美)', pinyin: 'alibaba' },
    { symbol: 'PDD', name: '拼多多', pinyin: 'pinduoduo' },
    { symbol: 'JD', name: '京东', pinyin: 'jingdong' },
    { symbol: 'BIDU', name: '百度', pinyin: 'baidu' },
    { symbol: 'NIO', name: '蔚来汽车', pinyin: 'weilai qiche' },
    { symbol: 'XPEV', name: '小鹏汽车', pinyin: 'xiaopeng qiche' },
    { symbol: 'LI', name: '理想汽车', pinyin: 'lixiang qiche' },
    { symbol: 'NTES', name: '网易(美)', pinyin: 'wangyi netease' },
    { symbol: 'BILI', name: '哔哩哔哩', pinyin: 'bilibili' },
    { symbol: 'TME', name: '腾讯音乐', pinyin: 'tengxun yinyue tme' },
    { symbol: 'TCOM', name: '携程集团', pinyin: 'xiecheng jituan trip' },
    { symbol: 'YUMC', name: '百胜中国', pinyin: 'baisheng zhongguo yum china' },
    { symbol: 'ZTO', name: '中通快递', pinyin: 'zhongtong kuaidi' },
    { symbol: 'MNSO', name: '名创优品', pinyin: 'mingchuang youpin miniso' },
    { symbol: 'EDU', name: '新东方', pinyin: 'xindongfang' },
    { symbol: 'TAL', name: '好未来', pinyin: 'hao weilai tal' },
    { symbol: 'IQ', name: '爱奇艺', pinyin: 'aiqiyi iqiyi' },
    { symbol: 'WB', name: '微博', pinyin: 'weibo' },
    { symbol: 'HTHT', name: '华住集团', pinyin: 'huazhu jituan' },
    { symbol: 'FUTU', name: '富途控股', pinyin: 'futu konggu' },
    { symbol: 'VNET', name: '世纪互联', pinyin: 'shiji hulian vnet' },
    { symbol: 'GDS', name: '万国数据', pinyin: 'wanguo shuju' },
    { symbol: 'QFIN', name: '奇富科技', pinyin: 'qifu keji 360finance' },
    { symbol: 'YMM', name: '满帮集团', pinyin: 'manbang jituan full truck' },
    { symbol: 'LKNCY', name: '瑞幸咖啡', pinyin: 'ruixing kafei luckin' },
    { symbol: 'DADA', name: '达达集团', pinyin: 'dada jituan' },
    { symbol: 'KC', name: '金山云', pinyin: 'jinshan yun kingsoft cloud' },

    // ======== 美股·科技巨头 ========
    { symbol: 'AAPL', name: '苹果', pinyin: 'pingguo apple' },
    { symbol: 'MSFT', name: '微软', pinyin: 'weiruan microsoft' },
    { symbol: 'GOOGL', name: '谷歌', pinyin: 'guge google alphabet' },
    { symbol: 'AMZN', name: '亚马逊', pinyin: 'yamaxun amazon' },
    { symbol: 'TSLA', name: '特斯拉', pinyin: 'tesila tesla' },
    { symbol: 'META', name: 'Meta/脸书', pinyin: 'lianshu facebook meta' },
    { symbol: 'NVDA', name: '英伟达', pinyin: 'yingweida nvidia' },
    { symbol: 'AMD', name: 'AMD/超威', pinyin: 'chaowei amd' },
    { symbol: 'INTC', name: '英特尔', pinyin: 'yingteer intel' },
    { symbol: 'NFLX', name: '奈飞', pinyin: 'naifei netflix' },
    { symbol: 'CRM', name: 'Salesforce', pinyin: 'salesforce' },
    { symbol: 'ORCL', name: '甲骨文', pinyin: 'jiaguwen oracle' },
    { symbol: 'AVGO', name: '博通', pinyin: 'botong broadcom' },
    { symbol: 'QCOM', name: '高通', pinyin: 'gaotong qualcomm' },
    { symbol: 'UBER', name: '优步', pinyin: 'youbu uber' },
    { symbol: 'ABNB', name: '爱彼迎', pinyin: 'aibiying airbnb' },
    { symbol: 'COIN', name: 'Coinbase', pinyin: 'coinbase' },
    { symbol: 'SNOW', name: 'Snowflake', pinyin: 'snowflake' },
    { symbol: 'SQ', name: 'Block/Square', pinyin: 'block square' },
    { symbol: 'SHOP', name: 'Shopify', pinyin: 'shopify' },
  ];

  private isChinese(str: string): boolean {
    return /[\u4e00-\u9fff]/.test(str);
  }

  async getPrice(symbol: string): Promise<number> {
    const data = await requestWithRetry<any>({
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
      params: { interval: '1d', range: '1d' },
      timeout: 15000
    });
    return parseFloat(data.chart.result[0].meta.regularMarketPrice);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return false;
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const q = query.toLowerCase().trim();

    // 先在中文本地列表中搜索（中文名、拼音、股票代码都匹配）
    const localResults = this.cnStocks.filter(s =>
      s.name.includes(q) ||
      s.pinyin.includes(q) ||
      s.symbol.toLowerCase().includes(q)
    ).map(s => ({ symbol: s.symbol, name: s.name }));

    if (localResults.length > 0) return localResults.slice(0, 20);

    // 如果是中文输入但本地没匹配到，直接返回空（Yahoo 对中文支持差）
    if (this.isChinese(q)) return [];

    // 英文关键词走 Yahoo Finance API
    try {
      const data = await requestWithRetry<any>({
        url: 'https://query1.finance.yahoo.com/v1/finance/search',
        params: { q: query, quotesCount: 30, newsCount: 0, enableFuzzyQuery: true },
        timeout: 15000
      });

      return data.quotes
        .filter((item: any) => item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
        .map((item: any) => ({
          symbol: item.symbol,
          name: `${item.longname || item.shortname || item.symbol} (${item.exchDisp || item.exchange || ''})`
        }));
    } catch (error) {
      const err: any = error;
      const status = err?.response?.status;
      const msg = err?.message || 'Unknown error';
      // 这是“搜索接口”失败，不影响监控推送；避免打印整个 axios error 对象刷满日志。
      console.error(`Yahoo Finance 搜索失败: status=${status ?? 'unknown'} msg=${msg} query="${query}"`);
      return [];
    }
  }
}

// 贵金属 - 通过 Yahoo Finance 期货行情获取
class MetalsProvider implements PriceProvider {
  private readonly metals = [
    { symbol: 'gold', name: '黄金 (Gold)', yahoo: 'GC=F' },
    { symbol: 'silver', name: '白银 (Silver)', yahoo: 'SI=F' },
    { symbol: 'platinum', name: '铂金 (Platinum)', yahoo: 'PL=F' },
    { symbol: 'palladium', name: '钯金 (Palladium)', yahoo: 'PA=F' }
  ];

  async getPrice(symbol: string): Promise<number> {
    const metal = this.metals.find(m => m.symbol.toLowerCase() === symbol.toLowerCase());
    if (!metal) throw new Error(`未知贵金属: ${symbol}`);

    const data = await requestWithRetry<any>({
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${metal.yahoo}`,
      params: { interval: '1d', range: '1d' },
      timeout: 15000
    });
    return parseFloat(data.chart.result[0].meta.regularMarketPrice);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    return this.metals.some(m => m.symbol.toLowerCase() === symbol.toLowerCase());
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    return this.metals.filter(m =>
      m.symbol.toLowerCase().includes(query.toLowerCase()) ||
      m.name.toLowerCase().includes(query.toLowerCase())
    );
  }
}

// Forex API - 外汇
class ForexProvider implements PriceProvider {
  private readonly currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD'];

  async getPrice(symbol: string): Promise<number> {
    const [base, quote] = symbol.split('/');
    const data = await requestWithRetry<any>({
      url: `https://api.exchangerate-api.com/v4/latest/${base}`,
      timeout: 15000
    });
    return parseFloat(data.rates[quote]);
  }

  async validateSymbol(symbol: string): Promise<boolean> {
    try {
      await this.getPrice(symbol);
      return true;
    } catch {
      return false;
    }
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string }>> {
    const results: Array<{ symbol: string; name: string }> = [];
    const q = query.toUpperCase();

    for (const base of this.currencies) {
      for (const quote of this.currencies) {
        if (base !== quote && (base.includes(q) || quote.includes(q))) {
          results.push({
            symbol: `${base}/${quote}`,
            name: `${base} to ${quote}`
          });
        }
      }
    }

    return results.slice(0, 20);
  }
}

// 价格服务管理器
export class PriceService {
  private providers: Map<AssetType, PriceProvider>;

  constructor() {
    this.providers = new Map<AssetType, PriceProvider>([
      ['crypto', new CryptoProvider()],
      ['stock', new YahooFinanceProvider()],
      ['metal', new MetalsProvider()],
      ['forex', new ForexProvider()]
    ]);
  }

  async getPrice(type: AssetType, symbol: string): Promise<number> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`不支持的资产类型: ${type}`);
    }
    return provider.getPrice(symbol);
  }

  async validateSymbol(type: AssetType, symbol: string): Promise<boolean> {
    const provider = this.providers.get(type);
    if (!provider) return false;
    return provider.validateSymbol(symbol);
  }

  async searchSymbols(type: AssetType, query: string): Promise<Array<{ symbol: string; name: string }>> {
    const provider = this.providers.get(type);
    if (!provider) return [];
    return provider.searchSymbols(query);
  }

  // 批量获取价格
  async getPrices(assets: Array<{ type: AssetType; symbol: string }>): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    await Promise.allSettled(
      assets.map(async (asset) => {
        try {
          const price = await this.getPrice(asset.type, asset.symbol);
          prices.set(`${asset.type}:${asset.symbol}`, price);
        } catch (error) {
          console.error(`获取价格失败 ${asset.type}:${asset.symbol}:`, error);
        }
      })
    );

    return prices;
  }
}

export const priceService = new PriceService();

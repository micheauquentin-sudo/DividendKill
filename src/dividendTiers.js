// Dividend Kings: 50+ consecutive years of dividend increases
export const DIVIDEND_KINGS = new Set([
  'ABM','ABT','AWR','BEN','BKH','CL','CLX','CNS','CINF','COKE',
  'CBSH','CB','DOV','EMR','ENB','FRT','FUL','GPC','HRL','ITW',
  'JNJ','JNPR','KO','LANC','LEG','LECO','LOW','MCD','MDT','MKC',
  'MMM','MSA','NDSN','NLSN','NNN','NWCO','O','PG','PH','PPG',
  'RYCEY','SCL','SJW','SWK','SYY','T','TGT','TR','UVV','VFC',
  'WMT','AWR','CBSH','COKE','CTBI','FRME','MSA','NNN','NWCO',
  'SCL','SJW','CTWS','MSEX','YORK',
]);

// Dividend Aristocrats: S&P 500 with 25+ years (not already Kings)
export const DIVIDEND_ARISTOCRATS = new Set([
  'ADM','ADP','AFL','AIR','ALB','AMCR','AOS','APD','ATO',
  'BAX','BBY','BDX','BF.B','BMY','BR','CAH','CAT','CB',
  'CHRW','CHD','CLX','CME','CNC','CVX','ECL','ED','EFX',
  'ESS','ETN','EVRG','EXR','EXPD','FAST','FDS','GD',
  'GILD','GIS','GPC','GWW','HAL','HBAN','HD','HIG','HRL',
  'HSY','IBM','ICE','IEX','ITW','J','JKHY','JNJ','KMB',
  'KO','L','LDOS','LEG','LIN','LOW','MDT','MKC','MMC',
  'MSFT','NUE','O','ORLY','PBCT','PBIPF','PEG','PEP',
  'PG','PNR','PPG','PRGO','ROP','RSG','SBUX','SHW',
  'SNA','SPGI','SWK','SYY','T','TGT','TRV','TROW',
  'UDR','VFC','VTR','WAT','WBA','WEC','WM','WMT',
  'WST','XOM',
]);

// Dividend Champions: 25+ years, any exchange (not already Kings or Aristocrats)
export const DIVIDEND_CHAMPIONS = new Set([
  'AAME','AAWW','ABCO','ACA','ACU','ADP','AFBI','AFG','AGCO',
  'AGYS','AIT','AJRD','ALE','ALGT','ALK','ALLE','AMBC','AME',
  'AMSF','AMWD','ANIK','APOG','APT','ARC','AROW','ASB','ASRV',
  'ATR','ATRI','AZO','BA','BASI','BANF','BANR','BBW','BCBP',
  'BHLB','BJ','BKE','BKNG','BKSC','BLK','BMI','BOCH','BPOP',
  'BSY','BUSE','CADE','CAKE','CASS','CATO','CBCYB','CBF','CBL',
  'CBNK','CBPO','CBSH','CCK','CENTA','CFB','CFFI','CFNL','CGNT',
  'CHCO','CIZN','CLBK','CLFD','CLNC','CMI','CNB','CNBKA','CNC',
  'CNOB','CNXN','CNXS','COGI','COHU','COLB','CONN','COST','CPRT',
  'CRWS','CSL','CTBI','CVBF','CVS','CWT','CZWI','DAL','DBD',
  'DCOM','DCI','DGII','DG','DLTR','DNB','DORM','DPZ','DRE',
  'EBMT','EE','EGAN','EGHT','EGP','ELIG','EPIQ','ESE','ESSA',
  'EVTC','EXP','FAF','FBNC','FBRC','FBRX','FCFS','FCN','FDEF',
  'FDP','FELE','FFBC','FFNW','FGL','FISI','FITB','FLIR','FMBI',
  'FMCB','FNBO','FNLC','FORO','FRPH','FSBC','FSBW','FSCR','FSS',
  'FWRD','GABC','GBCI','GCO','GES','GFED','GFF','GFIG','GLAD',
  'GMS','GNTX','GNTY','GOV','GPK','GPMT','GRIF','GUT','HAFC',
  'HAIN','HALL','HASI','HBCP','HIFS','HIBB','HIL','HLIC','HMST',
  'HNI','HOPE','HTBK','HTH','HZO','IBP','IBTX','ICAR','IDCC',
  'IIIN','INFU','INGN','IOSP','IPGP','JBSS','JJSF','JPNL','JW.A',
  'KELYA','KFRC','KLIC','KNSL','KWR','LAD','LADR','LARK','LAWS',
  'LCII','LGI','LHCG','LKQ','LMNR','LMNX','LNCO','LNKD','LPLA',
  'LPSN','LTC','LWAY','MACK','MAIN','MARA','MATW','MBIN','MBWM',
  'MGEE','MGPI','MLAB','MLM','MLNK','MMI','MNRO','MNTV','MOH',
  'MORN','MPW','MSB','MSBI','MSFG','MSM','MSSNF','MTB','MTSC',
  'MWA','MYPS','NAT','NBTB','NCR','NIC','NKLA','NLSN','NMFC',
  'NOVT','NPO','NRIM','NTIC','NUAN','NUVA','NWBI','NWFL','NWPX',
  'NXRT','NYB','ODP','OFG','OFTF','OLMA','OMED','ORI','OTC',
  'OTTR','OUSA','OVBC','OVLY','OXSQ','OZRK','PACB','PACW',
  'PB','PBHC','PCAR','PCH','PFBC','PFC','PFIS','PFS','PGC',
  'PKBK','PLOW','PMT','PNFP','PNNT','PNW','PPC','PPDF','PRAA',
  'PRIM','PRK','PRSC','PSBQ','PSIX','PSTL','PTGX','PTVC','PZZA',
  'RBCAA','RBCN','RBNC','RCI','RCMT','RES','REXR','RGR','RGS',
  'RNST','ROIC','RVSB','RYAM','SASR','SBCF','SBFG','SBSI','SCVL',
  'SIGI','SILC','SIRI','SKFRY','SKT','SLGN','SM','SMBC','SMTB',
  'SNBR','SNEX','SPNS','SSNC','STAA','STAR','STBA','STC','STFC',
  'STKL','STLD','STLS','STRH','STRL','STRS','SUMO','SVVC','SYBT',
  'TCBK','TCFC','TCFS','TDC','TGNA','TGTX','THFF','TITN','TLYS',
  'TNET','TOT','TOWN','TPCO','TPVG','TREE','TRS','TSBK','TSVT',
  'TTEC','TUES','TUP','TWO','TXN','UBCP','UBFO','UBOH','UBSI',
  'UCBI','UFCS','UHT','UMBF','UMPQ','UNTY','UONE','URG','USAK',
  'USLM','UTMD','UVSP','VALU','VBFC','VCNX','VEI','VETM','VFC',
  'VGR','VIAV','VIDE','VIEW','VIRT','VLGEA','VLRS','VMI','VNET',
  'VTOL','VXRT','WAFD','WASH','WBCO','WCFB','WDFC','WMPN','WNEB',
  'WRLD','WSBC','WSFS','WTBA','WTFC','WWD','XBRG','XIIX','XPER',
  'YADG','YORW','ZEUS',
]);

export function getDivBadge(ticker) {
  const t = ticker?.toUpperCase();
  if (!t) return '';
  if (DIVIDEND_KINGS.has(t))       return ' 👑';
  if (DIVIDEND_ARISTOCRATS.has(t)) return ' ⚜️';
  if (DIVIDEND_CHAMPIONS.has(t))   return ' 🎖️';
  return '';
}

import { useI18n, type Lang } from '../i18n'

const en = {
  navigation: 'Company navigation',
  heroEyebrow: 'Cross-border payments',
  heroFirst: 'Connecting people.',
  heroSecond: 'Enabling possibility.',
  heroIntro:
    'XpressTend Financial Services is a Seattle-based cross-border payments company focused on clear, accessible remittance experiences and responsible financial partnerships.',
  partnerAction: 'Discuss a partnership',
  companyAction: 'Discover XpressTend',
  companyEyebrow: 'XpressTend Financial Services',
  companyTitle: 'A clear purpose. A responsible approach.',
  companyBody:
    'Our focus is helping people stay connected to family across borders through transparent pricing, accessible technology, and accountable operations.',
  companyLink: 'About the company',
  factsLocation: 'Headquarters',
  factsRegistration: 'NMLS registration',
  factsFocus: 'Our focus',
  factsFocusValue: 'Cross-border remittances',
  principlesEyebrow: 'Our approach',
  principlesTitle: 'Clarity at every step.',
  clarityTitle: 'Transparent experiences',
  clarityBody:
    'Clear transfer details and pricing are central to our approach to remittances.',
  accessTitle: 'Accessible by design',
  accessBody:
    'A multilingual digital experience supports the communities and families we aim to serve.',
  accountabilityTitle: 'Accountable operations',
  accountabilityBody:
    'Identity checks, transaction review, and documented controls guide our operational approach.',
  partnerEyebrow: 'Partnerships',
  partnerTitle: 'Let’s connect the next opportunity.',
  partnerBody:
    'We welcome discussions with financial institutions, fintech companies, and payment infrastructure providers about banking, payouts, identity verification, and payment connectivity.',
  partnerLink: 'Explore partnership opportunities',
  trustEyebrow: 'Company information',
  trustTitle: 'Confidence starts with clarity.',
  trustBody:
    'Review our company profile, compliance approach, and security practices, or contact us directly for a partnership discussion.',
  footerContact: 'Contact',
  footerPrivacy: 'Privacy',
  inquiryAction: 'Contact XpressTend',
  inquirySubject: 'Partnership enquiry',
} as const

type CorporateCopy = { [K in keyof typeof en]: string }

const so: CorporateCopy = {
  navigation: 'Hagaha shirkadda',
  heroEyebrow: 'Lacag-bixinta xuduudaha ka gudubta',
  heroFirst: 'Dadka ayaan isku xirnaa.',
  heroSecond: 'Fursado ayaan suuragelinnaa.',
  heroIntro:
    'XpressTend Financial Services waa shirkad lacag-bixineed oo fadhigeedu yahay Seattle, kana shaqaysa lacag-bixinta xuduudaha ka gudubta. Waxaan diiradda saarnaa adeegyo xawaaladeed oo cad oo la heli karo iyo iskaashi maaliyadeed oo mas’uuliyad leh.',
  partnerAction: 'Ka wada hadal iskaashi',
  companyAction: 'Baro XpressTend',
  companyEyebrow: 'XpressTend Financial Services',
  companyTitle: 'Ujeeddo cad. Hab mas’uuliyad leh.',
  companyBody:
    'Waxaan diiradda saarnaa sidii dadka loogu caawin lahaa inay xiriir la yeeshaan qoysaskooda dalalka kale, annagoo adeegsanayna qiimayn daahfuran, tignoolajiyad la heli karo iyo hawlgal lala xisaabtami karo.',
  companyLink: 'Ku saabsan shirkadda',
  factsLocation: 'Xarunta dhexe',
  factsRegistration: 'Diiwaangelinta NMLS',
  factsFocus: 'Waxa aan diiradda saarno',
  factsFocusValue: 'Xawaaladaha xuduudaha ka gudba',
  principlesEyebrow: 'Habkayaga',
  principlesTitle: 'Caddayn tallaabo kasta.',
  clarityTitle: 'Adeegyo daahfuran',
  clarityBody:
    'Faahfaahinta xawaaladaha iyo qiimaha oo cad ayaa udub-dhexaad u ah habkayaga xawaaladaha.',
  accessTitle: 'Helitaan sahlan oo qorshaysan',
  accessBody:
    'Adeeg dijitaal ah oo luqado badan leh ayaa taageera bulshooyinka iyo qoysaska aan hiigsanayno inaan u adeegno.',
  accountabilityTitle: 'Hawlgal lala xisaabtami karo',
  accountabilityBody:
    'Hubinta aqoonsiga, dib-u-eegista macaamilada iyo habraacyo la diiwaangeliyay ayaa hagaya habkayaga hawlgalka.',
  partnerEyebrow: 'Iskaashiyada',
  partnerTitle: 'Aan wada abuurno fursadda xigta.',
  partnerBody:
    'Waxaan soo dhoweynaynaa wada-hadallada hay’adaha maaliyadda, shirkadaha tignoolajiyada maaliyadda iyo bixiyeyaasha kaabayaasha lacag-bixinta ee ku saabsan adeegyada bangiyada, bixinta lacagaha, xaqiijinta aqoonsiga iyo isku xirka nidaamyada lacag-bixinta.',
  partnerLink: 'Sahami fursadaha iskaashiga',
  trustEyebrow: 'Macluumaadka shirkadda',
  trustTitle: 'Kalsoonidu waxay ka bilaabataa caddayn.',
  trustBody:
    'Eeg xogta shirkaddayada, habkayaga u hoggaansanaanta sharciga iyo dhaqamadayada amniga, ama si toos ah noogala soo xiriir wada-hadal iskaashi.',
  footerContact: 'Xiriir',
  footerPrivacy: 'Asturnaanta',
  inquiryAction: 'La xiriir XpressTend',
  inquirySubject: 'Weydiin ku saabsan iskaashi',
}

const es: CorporateCopy = {
  navigation: 'Navegación de la empresa',
  heroEyebrow: 'Pagos transfronterizos',
  heroFirst: 'Conectamos personas.',
  heroSecond: 'Abrimos posibilidades.',
  heroIntro:
    'XpressTend Financial Services es una empresa de pagos transfronterizos con sede en Seattle, centrada en ofrecer experiencias de remesas claras y accesibles y en establecer alianzas financieras responsables.',
  partnerAction: 'Conversemos sobre una alianza',
  companyAction: 'Descubra XpressTend',
  companyEyebrow: 'XpressTend Financial Services',
  companyTitle: 'Un propósito claro. Un enfoque responsable.',
  companyBody:
    'Nos centramos en ayudar a las personas a mantener el vínculo con sus familias a través de las fronteras mediante precios transparentes, tecnología accesible y operaciones responsables.',
  companyLink: 'Acerca de la empresa',
  factsLocation: 'Sede',
  factsRegistration: 'Registro NMLS',
  factsFocus: 'Nuestro enfoque',
  factsFocusValue: 'Remesas transfronterizas',
  principlesEyebrow: 'Nuestro enfoque',
  principlesTitle: 'Claridad en cada paso.',
  clarityTitle: 'Experiencias transparentes',
  clarityBody:
    'La claridad en los detalles y precios de las transferencias es fundamental en nuestro enfoque de las remesas.',
  accessTitle: 'Accesibilidad desde el diseño',
  accessBody:
    'Una experiencia digital multilingüe apoya a las comunidades y familias a las que queremos servir.',
  accountabilityTitle: 'Operaciones responsables',
  accountabilityBody:
    'Las comprobaciones de identidad, la revisión de transacciones y los controles documentados orientan nuestro enfoque operativo.',
  partnerEyebrow: 'Alianzas',
  partnerTitle: 'Conectemos la próxima oportunidad.',
  partnerBody:
    'Recibimos con interés las conversaciones con instituciones financieras, empresas de tecnología financiera y proveedores de infraestructura de pagos sobre servicios bancarios, desembolsos, verificación de identidad y conectividad de pagos.',
  partnerLink: 'Explore oportunidades de colaboración',
  trustEyebrow: 'Información de la empresa',
  trustTitle: 'La confianza empieza con claridad.',
  trustBody:
    'Consulte el perfil de nuestra empresa, nuestro enfoque de cumplimiento y nuestras prácticas de seguridad, o contáctenos directamente para conversar sobre una alianza.',
  footerContact: 'Contacto',
  footerPrivacy: 'Privacidad',
  inquiryAction: 'Contactar con XpressTend',
  inquirySubject: 'Consulta sobre una alianza',
}

const pt: CorporateCopy = {
  navigation: 'Navegação da empresa',
  heroEyebrow: 'Pagamentos internacionais',
  heroFirst: 'Conectamos pessoas.',
  heroSecond: 'Criamos possibilidades.',
  heroIntro:
    'A XpressTend Financial Services é uma empresa de pagamentos internacionais com sede em Seattle, focada em experiências de remessas claras e acessíveis e em parcerias financeiras responsáveis.',
  partnerAction: 'Converse sobre uma parceria',
  companyAction: 'Conheça a XpressTend',
  companyEyebrow: 'XpressTend Financial Services',
  companyTitle: 'Um propósito claro. Uma abordagem responsável.',
  companyBody:
    'Nosso foco é ajudar as pessoas a manterem o vínculo com suas famílias além das fronteiras, por meio de preços transparentes, tecnologia acessível e operações responsáveis.',
  companyLink: 'Sobre a empresa',
  factsLocation: 'Sede',
  factsRegistration: 'Registro NMLS',
  factsFocus: 'Nosso foco',
  factsFocusValue: 'Remessas internacionais',
  principlesEyebrow: 'Nossa abordagem',
  principlesTitle: 'Clareza em cada etapa.',
  clarityTitle: 'Experiências transparentes',
  clarityBody:
    'Detalhes e preços claros das transferências são fundamentais para nossa abordagem de remessas.',
  accessTitle: 'Acessibilidade desde o início',
  accessBody:
    'Uma experiência digital multilíngue apoia as comunidades e famílias que buscamos atender.',
  accountabilityTitle: 'Operações responsáveis',
  accountabilityBody:
    'Verificações de identidade, análise de transações e controles documentados orientam nossa abordagem operacional.',
  partnerEyebrow: 'Parcerias',
  partnerTitle: 'Vamos conectar a próxima oportunidade.',
  partnerBody:
    'Estamos abertos a conversas com instituições financeiras, empresas de tecnologia financeira e provedores de infraestrutura de pagamentos sobre serviços bancários, desembolsos, verificação de identidade e conectividade de pagamentos.',
  partnerLink: 'Explore oportunidades de parceria',
  trustEyebrow: 'Informações da empresa',
  trustTitle: 'A confiança começa com clareza.',
  trustBody:
    'Conheça o perfil da nossa empresa, nossa abordagem de conformidade e nossas práticas de segurança, ou entre em contato diretamente para conversar sobre uma parceria.',
  footerContact: 'Contato',
  footerPrivacy: 'Privacidade',
  inquiryAction: 'Entre em contato com a XpressTend',
  inquirySubject: 'Consulta sobre parceria',
}

const ar: CorporateCopy = {
  navigation: 'التنقل في معلومات الشركة',
  heroEyebrow: 'المدفوعات عبر الحدود',
  heroFirst: 'نصل بين الناس.',
  heroSecond: 'نفتح آفاقاً جديدة.',
  heroIntro:
    'XpressTend Financial Services شركة مدفوعات عبر الحدود مقرها سياتل، تركز على تجارب تحويل أموال واضحة ومتاحة للجميع، وعلى شراكات مالية مسؤولة.',
  partnerAction: 'ناقش فرصة شراكة',
  companyAction: 'تعرّف على XpressTend',
  companyEyebrow: 'XpressTend Financial Services',
  companyTitle: 'هدف واضح. ونهج مسؤول.',
  companyBody:
    'نركز على مساعدة الناس في الحفاظ على تواصلهم مع عائلاتهم عبر الحدود من خلال تسعير شفاف وتقنية سهلة الوصول وعمليات تخضع للمساءلة.',
  companyLink: 'عن الشركة',
  factsLocation: 'المقر الرئيسي',
  factsRegistration: 'التسجيل في NMLS',
  factsFocus: 'مجال تركيزنا',
  factsFocusValue: 'تحويل الأموال عبر الحدود',
  principlesEyebrow: 'نهجنا',
  principlesTitle: 'وضوح في كل خطوة.',
  clarityTitle: 'تجارب شفافة',
  clarityBody:
    'وضوح تفاصيل التحويل وتسعيره ركيزة أساسية في نهجنا لتحويل الأموال.',
  accessTitle: 'سهولة الوصول من أساس التصميم',
  accessBody:
    'تدعم تجربة رقمية متعددة اللغات المجتمعات والعائلات التي نسعى إلى خدمتها.',
  accountabilityTitle: 'عمليات تخضع للمساءلة',
  accountabilityBody:
    'توجّه عمليات التحقق من الهوية ومراجعة المعاملات والضوابط الموثّقة نهجنا التشغيلي.',
  partnerEyebrow: 'الشراكات',
  partnerTitle: 'لنفتح معاً فرصة جديدة.',
  partnerBody:
    'نرحّب بالمناقشات مع المؤسسات المالية وشركات التقنية المالية ومزوّدي البنية التحتية للمدفوعات حول الخدمات المصرفية وصرف الأموال والتحقق من الهوية والربط بين أنظمة الدفع.',
  partnerLink: 'استكشف فرص الشراكة',
  trustEyebrow: 'معلومات الشركة',
  trustTitle: 'الثقة تبدأ بالوضوح.',
  trustBody:
    'اطّلع على ملف شركتنا ونهجنا في الامتثال وممارساتنا الأمنية، أو تواصل معنا مباشرة لمناقشة شراكة.',
  footerContact: 'التواصل',
  footerPrivacy: 'الخصوصية',
  inquiryAction: 'تواصل مع XpressTend',
  inquirySubject: 'استفسار بشأن شراكة',
}

const dictionaries: Record<Lang, CorporateCopy> = {
  en,
  so,
  es,
  'pt-BR': pt,
  ar,
}

export function useCorporateCopy(): CorporateCopy {
  const { lang } = useI18n()
  return dictionaries[lang]
}

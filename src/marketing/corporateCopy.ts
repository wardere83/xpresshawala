import { useI18n, type Lang } from '../i18n'

const en = {
  navigation: 'Company navigation',
  heroEyebrow: 'Cross-border payments',
  heroFirst: 'Connecting people.',
  heroSecond: 'Enabling possibility.',
  heroIntro:
    'XpressTend Financial Services is a Seattle-based cross-border payments company focused on clear, accessible remittance experiences and lasting investment in the communities we serve.',
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
  partnerEyebrow: 'Philanthropy',
  partnerTitle: 'Let’s also make financial literacy cool.',
  partnerBody:
    'We build real money skills and lasting upward mobility in underserved communities across Washington state, Nairobi, São Paulo, and beyond.',
  partnerLink: 'Explore XpressTend Financial Literacy',
  trustEyebrow: 'Company information',
  trustTitle: 'Confidence starts with clarity.',
  trustBody:
    'Review our company profile, compliance approach, and security practices, or see how we invest in the communities we serve.',
  footerContact: 'Contact',
  footerPrivacy: 'Privacy',
  inquiryAction: 'Contact XpressTend',
  inquirySubject: 'Financial Literacy enquiry',
} as const

type CorporateCopy = { [K in keyof typeof en]: string }

const so: CorporateCopy = {
  navigation: 'Hagaha shirkadda',
  heroEyebrow: 'Lacag-bixinta xuduudaha ka gudubta',
  heroFirst: 'Dadka ayaan isku xirnaa.',
  heroSecond: 'Fursado ayaan suuragelinnaa.',
  heroIntro:
    'XpressTend Financial Services waa shirkad lacag-bixineed oo fadhigeedu yahay Seattle, kana shaqaysa lacag-bixinta xuduudaha ka gudubta. Waxaan diiradda saarnaa adeegyo xawaaladeed oo cad oo la heli karo iyo maalgashi waara oo aan ku samayno bulshooyinka aan u adeegno.',
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
  partnerEyebrow: 'Samafal',
  partnerTitle: 'Aan sidoo kale aqoonta maaliyadda ka dhigno wax xiiso leh.',
  partnerBody:
    'Waxaan bulshooyinka aan helin adeeg ku filan ee ku nool gobolka Washington, Nairobi, São Paulo iyo meelo kale ka dhisnaa xirfado lacag-maamul oo dhab ah iyo horumar nololeed oo waara.',
  partnerLink: 'Baro XpressTend Financial Literacy',
  trustEyebrow: 'Macluumaadka shirkadda',
  trustTitle: 'Kalsoonidu waxay ka bilaabataa caddayn.',
  trustBody:
    'Eeg xogta shirkaddayada, habkayaga u hoggaansanaanta sharciga iyo dhaqamadayada amniga, ama arag sida aan u maalgashanno bulshooyinka aan u adeegno.',
  footerContact: 'Xiriir',
  footerPrivacy: 'Asturnaanta',
  inquiryAction: 'La xiriir XpressTend',
  inquirySubject: 'Weydiin ku saabsan aqoonta maaliyadda',
}

const es: CorporateCopy = {
  navigation: 'Navegación de la empresa',
  heroEyebrow: 'Pagos transfronterizos',
  heroFirst: 'Conectamos personas.',
  heroSecond: 'Abrimos posibilidades.',
  heroIntro:
    'XpressTend Financial Services es una empresa de pagos transfronterizos con sede en Seattle, centrada en ofrecer experiencias de remesas claras y accesibles y en invertir de forma duradera en las comunidades a las que servimos.',
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
  partnerEyebrow: 'Filantropía',
  partnerTitle: 'Hagamos también que la educación financiera sea genial.',
  partnerBody:
    'Desarrollamos habilidades financieras reales y una movilidad ascendente duradera en comunidades desatendidas del estado de Washington, Nairobi, São Paulo y más allá.',
  partnerLink: 'Conozca XpressTend Financial Literacy',
  trustEyebrow: 'Información de la empresa',
  trustTitle: 'La confianza empieza con claridad.',
  trustBody:
    'Consulte el perfil de nuestra empresa, nuestro enfoque de cumplimiento y nuestras prácticas de seguridad, o descubra cómo invertimos en las comunidades a las que servimos.',
  footerContact: 'Contacto',
  footerPrivacy: 'Privacidad',
  inquiryAction: 'Contactar con XpressTend',
  inquirySubject: 'Consulta sobre educación financiera',
}

const pt: CorporateCopy = {
  navigation: 'Navegação da empresa',
  heroEyebrow: 'Pagamentos internacionais',
  heroFirst: 'Conectamos pessoas.',
  heroSecond: 'Criamos possibilidades.',
  heroIntro:
    'A XpressTend Financial Services é uma empresa de pagamentos internacionais com sede em Seattle, focada em experiências de remessas claras e acessíveis e em um investimento duradouro nas comunidades que atendemos.',
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
  partnerEyebrow: 'Filantropia',
  partnerTitle: 'Vamos também fazer da educação financeira algo descolado.',
  partnerBody:
    'Desenvolvemos habilidades financeiras reais e mobilidade social duradoura em comunidades desassistidas no estado de Washington, em Nairóbi, em São Paulo e além.',
  partnerLink: 'Conheça o XpressTend Financial Literacy',
  trustEyebrow: 'Informações da empresa',
  trustTitle: 'A confiança começa com clareza.',
  trustBody:
    'Conheça o perfil da nossa empresa, nossa abordagem de conformidade e nossas práticas de segurança, ou veja como investimos nas comunidades que atendemos.',
  footerContact: 'Contato',
  footerPrivacy: 'Privacidade',
  inquiryAction: 'Entre em contato com a XpressTend',
  inquirySubject: 'Consulta sobre educação financeira',
}

const ar: CorporateCopy = {
  navigation: 'التنقل في معلومات الشركة',
  heroEyebrow: 'المدفوعات عبر الحدود',
  heroFirst: 'نصل بين الناس.',
  heroSecond: 'نفتح آفاقاً جديدة.',
  heroIntro:
    'XpressTend Financial Services شركة مدفوعات عبر الحدود مقرها سياتل، تركز على تجارب تحويل أموال واضحة ومتاحة للجميع، وعلى استثمار دائم في المجتمعات التي نخدمها.',
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
  partnerEyebrow: 'العطاء المجتمعي',
  partnerTitle: 'لنجعل الثقافة المالية ممتعة أيضاً.',
  partnerBody:
    'نبني مهارات مالية حقيقية وارتقاءً اجتماعياً واقتصادياً دائماً في المجتمعات الأقل حصولاً على الخدمات في ولاية واشنطن ونيروبي وساو باولو وما وراءها.',
  partnerLink: 'استكشف XpressTend Financial Literacy',
  trustEyebrow: 'معلومات الشركة',
  trustTitle: 'الثقة تبدأ بالوضوح.',
  trustBody:
    'اطّلع على ملف شركتنا ونهجنا في الامتثال وممارساتنا الأمنية، أو تعرّف على كيفية استثمارنا في المجتمعات التي نخدمها.',
  footerContact: 'التواصل',
  footerPrivacy: 'الخصوصية',
  inquiryAction: 'تواصل مع XpressTend',
  inquirySubject: 'استفسار بشأن الثقافة المالية',
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

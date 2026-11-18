// Package templates provides localised USSD screen text constants (sw-KE).
// Farmer-facing USSD content is delivered in Kiswahili per operational requirements.
// All screens are constrained to 160 characters including menu prompts.
package templates

const MainMenu = "Karibu GrainShield\n1. Sajili\n2. Bima Yangu\n3. Bei za Nafaka\n4. Omba Mkopo\n5. Thibitisha Pembejeo"

const (
	RegLanguage    = "Karibu GrainShield\n\nChagua lugha yako:\n1. Kiswahili\n2. English\n\nBonyeza nambari yako"
	RegNationalID  = "Ingiza nambari yako ya\nKitambulisho cha Taifa:"
	RegSubCounty   = "Chagua sub county yako:\n\n1. Kiminini\n2. Kwanza\n3. Saboti\n4. Endebess\n5. Cherangany"
	RegHectares    = "Ingiza hekta za shamba:"
	RegExpectedFmt = "Magunia unayotarajia\nkuvuna msimu huu:"
	RegConfirmFmt  = "UTHIBITISHO\nKitambulisho: %s\nSub County: %s\nHekta: %s\nMagunia: %s\n\n1. Thibitisha  9. Rudi"
	RegSuccessFmt  = "UMEFANIKIWA!\n\nKaribu GrainShield\nNamba: %s\n\nSMS imetumwa kwa\nuthibitisho"
	RegFailFmt     = "Usajili umeshindwa.\nJaribu tena baadaye.\n\n0. Menyu Kuu"
)

var SubCounties = [5]string{"Kiminini", "Kwanza", "Saboti", "Endebess", "Cherangany"}

const (
	InsNoPolicyFmt = "Hakuna bima ya sasa.\n\nHifadhi nafaka ghala la NCPB\nili kuanza bima.\n\n0. Menyu Kuu"
	InsStatusFmt   = "BIMA YANGU\n\nHali: %s\nMagunia: %s\nThamani: KES %s\nSiku zilizobaki: %s\n\n1. Uza leo\n2. Omba mkopo\n0. Menyu Kuu"
)

const (
	PriceHeaderFmt = "BEI YA WIKI HII\n%s\n\n1. Uza leo (bei bora)\n2. Subiri wiki ijayo"
	PriceSellFmt   = "Maagizo ya kuuza\nyamepokelewa.\n\nUthibitisho utakuja\nndani ya saa 48.\n\n0. Menyu Kuu"
)

const (
	LoanEligFmt     = "OMBA MKOPO\n\nAkiba yako: KES %s\nMkopo wa juu: KES %s\n(60%% ya thamani)\n\nIngiza kiasi unachotaka:"
	LoanConfirmFmt  = "UTHIBITISHO WA MKOPO\n\nKiasi: KES %s\nAda: KES %s (4%%)\nUtapata: KES %s\n\nMkopo M Pesa: 1 saa\n\n1. Kubali  9. Ghairi"
	LoanSuccessFmt  = "Mkopo umeidhinishwa!\n\nKES %s utatumwa kwa\nM Pesa ndani ya saa 1.\n\n0. Menyu Kuu"
	LoanNoPolicyFmt = "Huna nafaka zilizohifadhiwa.\nHifadhi kwanza ili\nkuomba mkopo.\n\n0. Menyu Kuu"
)

const (
	VerifyPrompt     = "THIBITISHA PEMBEJEO\n\nIngiza nambari iliyo\nkwenye mfuko wa\nmbolea au mbegu:"
	VerifyGenuineFmt = "HALISI  ✓\n\nMzalishaji: %s\nAina: %s\nKEBS: %s\nMuda: %s\n\nPunguzo la bima: 25%%"
	VerifyFakeFmt    = "BANDIA  ✗\n\nNambari hii HAIPO\nkwenye rejesta ya KEBS.\n\nPiga 0800 723 253\n(KEBS hotline)\n\n0. Menyu Kuu"
	VerifyErrorFmt   = "Uthibitisho haupatikani\nkwa sasa. Jaribu tena.\n\n0. Menyu Kuu"
)

const (
	InvalidInput = "Chaguo batili.\nJaribu tena."
	SessionError = "Tatizo la mfumo.\nJaribu tena baadaye."
	RateLimited  = "Tafadhali subiri dakika\nmoja kabla ya kujaribu\ntena."
)

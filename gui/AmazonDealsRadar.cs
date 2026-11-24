using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace AmazonDealsRadarApp
{
    public class MainWindow : Form
    {
        // UI Controls
        private TabControl mainTabs;
        private TabPage tabDashboard;
        private TabPage tabDeals;
        private TabPage tabSettings;
        private TabPage tabLogs;

        // Stat Card Labels
        private Label lblTotalProductsVal;
        private Label lblTotalDealsVal;
        private Label lblPriceDropsVal;
        private Label lblMinDiscountVal;
        private Label lblPostsPerSlotVal;

        // Settings Controls
        private TextBox txtAffiliateTag;
        private TextBox txtBotToken;
        private TextBox txtChannelId;
        private TextBox txtChannelName;
        private NumericUpDown numPostsPerSlot;
        private NumericUpDown numMinDiscount;
        private NumericUpDown numMaxPerCategory;
        private CheckBox chkHubLinks;
        private CheckBox chkTrustNotes;
        private CheckBox chkScreenshotCards;
        private Label lblSettingsStatus;

        // Deals Table
        private DataGridView dgvDeals;
        private TextBox txtSearchDeals;
        private ComboBox cmbDealFilter;
        private Label lblDealsCount;
        private List<Dictionary<string, object>> allProductsList = new List<Dictionary<string, object>>();

        // Logs Console
        private RichTextBox rtbConsole;
        private ProgressBar progressBar;
        private Label lblTaskStatus;
        private Button btnStopTask;

        // Status Strip
        private StatusStrip statusStrip;
        private ToolStripStatusLabel statusLabel;
        private ToolStripStatusLabel statusTimeLabel;

        // Process Management
        private Process currentProcess = null;
        private string projectDir = "";
        private string configPath = "";
        private string productsJsonPath = "";
        private string dealsReportJsonPath = "";
        private string nodeExe = "node";

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainWindow());
        }

        public MainWindow()
        {
            InitEnvironment();
            InitFormProperties();
            BuildHeader();
            BuildTabs();
            BuildStatusStrip();

            // Initial Data Load
            LoadSettings();
            LoadProductsData();
            UpdateDashboardStats();
        }

        private void InitEnvironment()
        {
            projectDir = AppDomain.CurrentDomain.BaseDirectory;
            // Handle if running from dist or subfolder
            if (!File.Exists(Path.Combine(projectDir, "config.json")) && File.Exists(Path.Combine(projectDir, "..", "config.json")))
            {
                projectDir = Path.GetFullPath(Path.Combine(projectDir, ".."));
            }

            configPath = Path.Combine(projectDir, "config.json");
            productsJsonPath = Path.Combine(projectDir, "products.json");
            dealsReportJsonPath = Path.Combine(projectDir, "deals_report.json");

            nodeExe = FindNodeBinary();
        }

        private string FindNodeBinary()
        {
            try
            {
                var p = Process.Start(new ProcessStartInfo("node", "-v")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                p.WaitForExit(1000);
                return "node";
            }
            catch { }

            string[] searchPaths = new string[]
            {
                @"D:\AutoCad\node.exe",
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
            };

            foreach (var path in searchPaths)
            {
                if (File.Exists(path)) return path;
            }

            return "node";
        }

        private void InitFormProperties()
        {
            this.Text = "رادار صفقات وعروض أمازون مصر — Deals Radar Pro";
            this.Size = new Size(1120, 750);
            this.MinimumSize = new Size(980, 640);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            this.RightToLeft = RightToLeft.Yes;
            this.RightToLeftLayout = true;

            string iconPath = Path.Combine(projectDir, "assets", "app.ico");
            if (File.Exists(iconPath))
            {
                try { this.Icon = new Icon(iconPath); } catch { }
            }
        }

        private void BuildHeader()
        {
            Panel headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 85,
                BackColor = Color.FromArgb(15, 23, 42), // Slate 900
                Padding = new Padding(20, 10, 20, 10)
            };

            // Avatar / Logo Icon
            PictureBox picLogo = new PictureBox
            {
                Size = new Size(60, 60),
                Location = new Point(20, 12),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Transparent
            };
            string avatarPath = Path.Combine(projectDir, "assets", "avatar.jpg");
            if (File.Exists(avatarPath))
            {
                try { picLogo.Image = Image.FromFile(avatarPath); } catch { }
            }
            headerPanel.Controls.Add(picLogo);

            // Title & Subtitle Panel
            Panel titlePanel = new Panel
            {
                Location = new Point(90, 12),
                Size = new Size(650, 60),
                BackColor = Color.Transparent
            };

            Label lblTitle = new Label
            {
                Text = "رادار عروض وتخفيضات أمازون مصر | Amazon Deals Radar",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.White,
                AutoSize = true,
                Location = new Point(0, 2)
            };

            Label lblSubtitle = new Label
            {
                Text = "منظومة المراقبة الذكية وكشف الخصومات الحقيقية والنشر الآلي لقناة التليجرام",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184), // Slate 400
                AutoSize = true,
                Location = new Point(0, 32)
            };

            titlePanel.Controls.Add(lblTitle);
            titlePanel.Controls.Add(lblSubtitle);
            headerPanel.Controls.Add(titlePanel);

            // Quick Website Button on Top Left
            Button btnOpenSite = new Button
            {
                Text = "🌐 موقع العروض",
                Size = new Size(135, 38),
                Anchor = AnchorStyles.Top | AnchorStyles.Left,
                Location = new Point(headerPanel.Width - 165, 22),
                BackColor = Color.FromArgb(79, 70, 229), // Indigo 600
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnOpenSite.FlatAppearance.BorderSize = 0;
            btnOpenSite.Click += (s, e) => OpenDealsWebPage();
            headerPanel.Controls.Add(btnOpenSite);

            this.Controls.Add(headerPanel);
        }

        private void BuildTabs()
        {
            mainTabs = new TabControl
            {
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Regular),
                Padding = new Point(20, 10),
                ItemSize = new Size(160, 42),
                SizeMode = TabSizeMode.Fixed
            };

            tabDashboard = new TabPage("📊 الرئيسية والتحكم");
            tabDeals = new TabPage("🛒 جدول العروض والمنتجات");
            tabSettings = new TabPage("⚙️ إعدادات البرنامج");
            tabLogs = new TabPage("💻 شاشة المخرجات والسجل");

            BuildDashboardTab();
            BuildDealsTab();
            BuildSettingsTab();
            BuildLogsTab();

            mainTabs.TabPages.Add(tabDashboard);
            mainTabs.TabPages.Add(tabDeals);
            mainTabs.TabPages.Add(tabSettings);
            mainTabs.TabPages.Add(tabLogs);

            this.Controls.Add(mainTabs);
            mainTabs.BringToFront();
        }

        // ==========================================
        // TAB 1: DASHBOARD & ACTIONS
        // ==========================================
        private void BuildDashboardTab()
        {
            tabDashboard.BackColor = Color.FromArgb(248, 250, 252);
            tabDashboard.Padding = new Padding(20);

            TableLayoutPanel pnlStats = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                Height = 115,
                ColumnCount = 5,
                RowCount = 1,
                Padding = new Padding(0, 0, 0, 15)
            };
            for (int i = 0; i < 5; i++)
            {
                pnlStats.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20f));
            }

            // Stat Card 1: Total Products
            lblTotalProductsVal = new Label();
            pnlStats.Controls.Add(CreateStatCard("📦 إجمالي المنتجات", "0", lblTotalProductsVal, Color.FromArgb(37, 99, 235)), 0, 0);

            // Stat Card 2: Real Deals
            lblTotalDealsVal = new Label();
            pnlStats.Controls.Add(CreateStatCard("🔥 العروض الحقيقية", "0", lblTotalDealsVal, Color.FromArgb(220, 38, 38)), 1, 0);

            // Stat Card 3: Price Drops
            lblPriceDropsVal = new Label();
            pnlStats.Controls.Add(CreateStatCard("⚡ هبوط أسعار جديد", "0", lblPriceDropsVal, Color.FromArgb(217, 119, 6)), 2, 0);

            // Stat Card 4: Min Discount
            lblMinDiscountVal = new Label();
            pnlStats.Controls.Add(CreateStatCard("🎯 الحد الأدنى للخصم", "25%", lblMinDiscountVal, Color.FromArgb(16, 185, 129)), 3, 0);

            // Stat Card 5: Posts Per Slot
            lblPostsPerSlotVal = new Label();
            pnlStats.Controls.Add(CreateStatCard("📢 صفقات كل ميعاد", "4", lblPostsPerSlotVal, Color.FromArgb(124, 58, 237)), 4, 0);

            tabDashboard.Controls.Add(pnlStats);

            // Action Buttons Container
            GroupBox grpActions = new GroupBox
            {
                Text = "⚡ مركز العمليات والتشغيل السريع",
                Dock = DockStyle.Fill,
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                ForeColor = Color.FromArgb(30, 41, 59),
                Padding = new Padding(20)
            };

            FlowLayoutPanel flowActions = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                AutoScroll = true,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(10)
            };

            // Button 1: Run Deals Tracker
            Button btnTrackDeals = CreateActionButton("🎯 فحص وتحديث الصفقات الحقيقية", "تحليل التخفيضات ومقارنتها بالسعر العادل", Color.FromArgb(220, 38, 38));
            btnTrackDeals.Click += (s, e) => RunNodeScript("deals_tracker.js", "فحص واكتشاف الصفقات الحقيقية");
            flowActions.Controls.Add(btnTrackDeals);

            // Button 2: Scrape Quick (5 Categories)
            Button btnScrapeQuick = CreateActionButton("⚡ كشط سريع (5 أقسام)", "تحديث أسعار أحدث المنتجات من أمازون مصر", Color.FromArgb(37, 99, 235));
            btnScrapeQuick.Click += (s, e) => RunNodeScript("full_store_scraper.js", "كشط سريع لأقسام المتجر", "--limit 5");
            flowActions.Controls.Add(btnScrapeQuick);

            // Button 3: Telegram Dry Run (Preview)
            Button btnTgPreview = CreateActionButton("🧪 تجربة نشر تليجرام (معاينة)", "محاكاة جدول ومحتوى المنشورات بدون إرسال فعلي", Color.FromArgb(13, 148, 136));
            btnTgPreview.Click += (s, e) => RunNodeScript(@"scripts\post_channel.js", "معاينة وتجربة نشر تليجرام", "--preview");
            flowActions.Controls.Add(btnTgPreview);

            // Button 4: Telegram Real Publish
            Button btnTgPublish = CreateActionButton("📢 نشر فوري على قناة تليجرام", "إرسال الصفقات المجدولة مباشرة للقناة الرسمية", Color.FromArgb(124, 58, 237));
            btnTgPublish.Click += (s, e) =>
            {
                var confirm = MessageBox.Show("هل ترغب في بدء نشر الصفقات فعلياً على قناة التليجرام الآن؟", "تأكيد النشر", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (confirm == DialogResult.Yes)
                {
                    RunNodeScript(@"scripts\post_channel.js", "نشر الصفقات لقناة تليجرام", "--schedule --force-now");
                }
            };
            flowActions.Controls.Add(btnTgPublish);

            // Button 5: Export Data
            Button btnExport = CreateActionButton("📊 تصدير الكتالوج (Excel / CSV)", "توليد ملفات الجداول والإحصائيات الحديثة", Color.FromArgb(16, 185, 129));
            btnExport.Click += (s, e) => RunNodeScript("export_data.js", "تصدير الكتالوج والبيانات");
            flowActions.Controls.Add(btnExport);

            // Button 6: Build Site
            Button btnBuildSite = CreateActionButton("🏗️ بناء موقع العروض والبراندات", "توليد صفحات الويب الثابتة المحسنة", Color.FromArgb(71, 85, 105));
            btnBuildSite.Click += (s, e) => RunNodeScript(@"src\build_deals_page.js", "بناء صفحات العروض والموقع");
            flowActions.Controls.Add(btnBuildSite);

            // Button 7: Run Full Scraper
            Button btnScrapeFull = CreateActionButton("🛒 كشط المتجر بالكامل (Full Scrape)", "زحف جميع أقسام وتصنيفات أمازون مصر Tez", Color.FromArgb(30, 41, 59));
            btnScrapeFull.Click += (s, e) =>
            {
                var confirm = MessageBox.Show("الكشط الكامل يستغرق عدة دقائق لفحص كافة الأقسام. هل ترغب في البدء؟", "تأكيد الكشط الكامل", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (confirm == DialogResult.Yes)
                {
                    RunNodeScript("full_store_scraper.js", "كشط وتحديث المتجر بالكامل");
                }
            };
            flowActions.Controls.Add(btnScrapeFull);

            // Button 8: Refresh Dashboard Data
            Button btnRefresh = CreateActionButton("🔄 تحديث بيانات اللوحة", "إعادة قراءة الصفقات والإحصائيات من الملفات", Color.FromArgb(100, 116, 139));
            btnRefresh.Click += (s, e) =>
            {
                LoadSettings();
                LoadProductsData();
                UpdateDashboardStats();
                MessageBox.Show("تم تحديث البيانات والإحصائيات بنجاح!", "تم التحديث", MessageBoxButtons.OK, MessageBoxIcon.Information);
            };
            flowActions.Controls.Add(btnRefresh);

            grpActions.Controls.Add(flowActions);
            tabDashboard.Controls.Add(grpActions);
            grpActions.BringToFront();
        }

        private Panel CreateStatCard(string title, string defaultVal, Label valLabel, Color accentColor)
        {
            Panel card = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.White,
                Margin = new Padding(5),
                Padding = new Padding(12)
            };

            // Top accent stripe
            Panel stripe = new Panel
            {
                Dock = DockStyle.Top,
                Height = 4,
                BackColor = accentColor
            };
            card.Controls.Add(stripe);

            Label lblTitle = new Label
            {
                Text = title,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(100, 116, 139),
                Dock = DockStyle.Top,
                Height = 22,
                TextAlign = ContentAlignment.MiddleRight
            };
            card.Controls.Add(lblTitle);

            valLabel.Text = defaultVal;
            valLabel.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
            valLabel.ForeColor = Color.FromArgb(15, 23, 42);
            valLabel.Dock = DockStyle.Fill;
            valLabel.TextAlign = ContentAlignment.MiddleCenter;
            card.Controls.Add(valLabel);

            return card;
        }

        private Button CreateActionButton(string title, string subtitle, Color bg)
        {
            Button btn = new Button
            {
                Size = new Size(245, 95),
                Margin = new Padding(10),
                BackColor = bg,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Cursor = Cursors.Hand,
                TextAlign = ContentAlignment.TopRight,
                Padding = new Padding(12, 10, 12, 8)
            };
            btn.FlatAppearance.BorderSize = 0;
            btn.Text = title + "\n\n" + subtitle;

            // Hover effect
            btn.MouseEnter += (s, e) => btn.BackColor = ControlPaint.Light(bg, 0.15f);
            btn.MouseLeave += (s, e) => btn.BackColor = bg;

            return btn;
        }

        // ==========================================
        // TAB 2: DEALS & PRODUCTS TABLE
        // ==========================================
        private void BuildDealsTab()
        {
            tabDeals.BackColor = Color.FromArgb(248, 250, 252);
            tabDeals.Padding = new Padding(15);

            // Filter Toolbar
            Panel pnlFilter = new Panel
            {
                Dock = DockStyle.Top,
                Height = 50,
                BackColor = Color.White,
                Padding = new Padding(10)
            };

            Label lblSearch = new Label
            {
                Text = "بحث:",
                Location = new Point(pnlFilter.Width - 60, 13),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                AutoSize = true,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold)
            };
            pnlFilter.Controls.Add(lblSearch);

            txtSearchDeals = new TextBox
            {
                Location = new Point(pnlFilter.Width - 320, 10),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Size = new Size(250, 30),
                Font = new Font("Segoe UI", 10f)
            };
            txtSearchDeals.TextChanged += (s, e) => FilterDealsGrid();
            pnlFilter.Controls.Add(txtSearchDeals);

            Label lblFilterType = new Label
            {
                Text = "التصفية:",
                Location = new Point(pnlFilter.Width - 400, 13),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                AutoSize = true,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold)
            };
            pnlFilter.Controls.Add(lblFilterType);

            cmbDealFilter = new ComboBox
            {
                Location = new Point(pnlFilter.Width - 580, 10),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Size = new Size(170, 30),
                DropDownStyle = ComboBoxStyle.DropDownList,
                Font = new Font("Segoe UI", 9.5f)
            };
            cmbDealFilter.Items.AddRange(new string[] { "جميع المنتجات", "العروض ذات الخصم فقط", "أرخص سعر اتسجل" });
            cmbDealFilter.SelectedIndex = 0;
            cmbDealFilter.SelectedIndexChanged += (s, e) => FilterDealsGrid();
            pnlFilter.Controls.Add(cmbDealFilter);

            lblDealsCount = new Label
            {
                Text = "العدد: 0",
                Location = new Point(20, 13),
                Anchor = AnchorStyles.Top | AnchorStyles.Left,
                AutoSize = true,
                ForeColor = Color.FromArgb(100, 116, 139),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };
            pnlFilter.Controls.Add(lblDealsCount);

            tabDeals.Controls.Add(pnlFilter);

            // Data Grid View
            dgvDeals = new DataGridView
            {
                Dock = DockStyle.Fill,
                BackgroundColor = Color.White,
                BorderStyle = BorderStyle.None,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                ReadOnly = true,
                SelectionMode = DataGridViewSelectionMode.FullRowSelect,
                MultiSelect = false,
                RowHeadersVisible = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                RowTemplate = { Height = 34 },
                Font = new Font("Segoe UI", 9.5f)
            };
            dgvDeals.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(241, 245, 249);
            dgvDeals.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(30, 41, 59);
            dgvDeals.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            dgvDeals.ColumnHeadersHeight = 38;
            dgvDeals.EnableHeadersVisualStyles = false;

            dgvDeals.Columns.Add("asin", "ASIN");
            dgvDeals.Columns.Add("title", "اسم المنتج");
            dgvDeals.Columns.Add("brand", "البراند");
            dgvDeals.Columns.Add("category", "القسم");
            dgvDeals.Columns.Add("currentPrice", "السعر الحالي");
            dgvDeals.Columns.Add("oldPrice", "السعر السابق");
            dgvDeals.Columns.Add("discount", "الخصم %");
            dgvDeals.Columns.Add("savings", "الوفر");

            // Open Link Button Column
            DataGridViewButtonColumn btnCol = new DataGridViewButtonColumn
            {
                Name = "openUrl",
                HeaderText = "الشراء من أمازون",
                Text = "🔗 فتح الرابط",
                UseColumnTextForButtonValue = true,
                Width = 110
            };
            dgvDeals.Columns.Add(btnCol);

            dgvDeals.Columns["asin"].Width = 100;
            dgvDeals.Columns["title"].Width = 320;
            dgvDeals.Columns["brand"].Width = 110;
            dgvDeals.Columns["category"].Width = 120;
            dgvDeals.Columns["currentPrice"].Width = 95;
            dgvDeals.Columns["oldPrice"].Width = 95;
            dgvDeals.Columns["discount"].Width = 85;
            dgvDeals.Columns["savings"].Width = 85;

            dgvDeals.CellContentClick += (s, e) =>
            {
                if (e.RowIndex >= 0 && e.ColumnIndex == dgvDeals.Columns["openUrl"].Index)
                {
                    string asin = dgvDeals.Rows[e.RowIndex].Cells["asin"].Value as string;
                    if (!string.IsNullOrEmpty(asin))
                    {
                        string tag = txtAffiliateTag != null ? txtAffiliateTag.Text.Trim() : "egdealsradar-21";
                        string url = string.Format("https://www.amazon.eg/dp/{0}?tag={1}&utm_source=telegram&utm_medium=channel&utm_campaign=desktop_gui", asin, tag);
                        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
                    }
                }
            };

            tabDeals.Controls.Add(dgvDeals);
            dgvDeals.BringToFront();
        }

        // ==========================================
        // TAB 3: CONFIGURATION SETTINGS
        // ==========================================
        private void BuildSettingsTab()
        {
            tabSettings.BackColor = Color.FromArgb(248, 250, 252);
            tabSettings.Padding = new Padding(25);
            tabSettings.AutoScroll = true;

            TableLayoutPanel pnlConfig = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                ColumnCount = 2,
                RowCount = 10,
                AutoSize = true,
                Padding = new Padding(10)
            };
            pnlConfig.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220f));
            pnlConfig.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            int row = 0;

            // 1. Affiliate Tag
            txtAffiliateTag = new TextBox { Width = 350, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "🏷️ كود الأفلييت (Amazon Tag):", txtAffiliateTag, row++);

            // 2. Bot Token
            txtBotToken = new TextBox { Width = 450, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "🤖 توكن بوت تليجرام (Bot Token):", txtBotToken, row++);

            // 3. Channel ID
            txtChannelId = new TextBox { Width = 350, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "📢 معرف القناة (Channel ID):", txtChannelId, row++);

            // 4. Channel Name
            txtChannelName = new TextBox { Width = 350, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "🏷️ اسم القناة الترويجية:", txtChannelName, row++);

            // 5. Posts Per Slot
            numPostsPerSlot = new NumericUpDown { Width = 120, Minimum = 1, Maximum = 20, Value = 4, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "🔢 عدد الصفقات لكل ميعاد نشر:", numPostsPerSlot, row++);

            // 6. Min Discount %
            numMinDiscount = new NumericUpDown { Width = 120, Minimum = 5, Maximum = 95, Value = 25, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "📉 الحد الأدنى لنسبة الخصم (%):", numMinDiscount, row++);

            // 7. Max per category
            numMaxPerCategory = new NumericUpDown { Width = 120, Minimum = 1, Maximum = 10, Value = 2, Font = new Font("Segoe UI", 10.5f) };
            AddConfigRow(pnlConfig, "⚖️ أقصى عدد منتجات لنفس القسم:", numMaxPerCategory, row++);

            // 8. Toggles
            Panel pnlChecks = new Panel { AutoSize = true };
            chkHubLinks = new CheckBox { Text = "تضمين روابط أقسام السوبرماركت (Hub Links)", Checked = true, AutoSize = true, Location = new Point(0, 0) };
            chkTrustNotes = new CheckBox { Text = "تضمين ملاحظات الثقة والشحن السريع (Trust Notes)", Checked = true, AutoSize = true, Location = new Point(0, 26) };
            chkScreenshotCards = new CheckBox { Text = "توليد كروت صور أمازون الاحترافية (Screenshot Cards)", Checked = true, AutoSize = true, Location = new Point(0, 52) };
            pnlChecks.Controls.Add(chkHubLinks);
            pnlChecks.Controls.Add(chkTrustNotes);
            pnlChecks.Controls.Add(chkScreenshotCards);
            AddConfigRow(pnlConfig, "⚙️ خيارات المحتوى المتقدمة:", pnlChecks, row++);

            // 9. Save Button & Status
            Panel pnlSave = new Panel { Height = 55, Width = 500 };
            Button btnSave = new Button
            {
                Text = "💾 حفظ الإعدادات في config.json",
                Size = new Size(230, 42),
                BackColor = Color.FromArgb(16, 185, 129), // Emerald 600
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Location = new Point(0, 5)
            };
            btnSave.FlatAppearance.BorderSize = 0;
            btnSave.Click += (s, e) => SaveSettings();

            Button btnReload = new Button
            {
                Text = "🔄 استعادة الإعدادات",
                Size = new Size(140, 42),
                BackColor = Color.FromArgb(100, 116, 139),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10f, FontStyle.Regular),
                Cursor = Cursors.Hand,
                Location = new Point(240, 5)
            };
            btnReload.FlatAppearance.BorderSize = 0;
            btnReload.Click += (s, e) => LoadSettings();

            lblSettingsStatus = new Label
            {
                Text = "",
                ForeColor = Color.FromArgb(16, 185, 129),
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(390, 15)
            };

            pnlSave.Controls.Add(btnSave);
            pnlSave.Controls.Add(btnReload);
            pnlSave.Controls.Add(lblSettingsStatus);

            AddConfigRow(pnlConfig, "", pnlSave, row++);

            tabSettings.Controls.Add(pnlConfig);
        }

        private void AddConfigRow(TableLayoutPanel table, string labelText, Control ctrl, int row)
        {
            Label lbl = new Label
            {
                Text = labelText,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(51, 65, 85),
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleRight
            };
            table.Controls.Add(lbl, 0, row);
            table.Controls.Add(ctrl, 1, row);
        }

        // ==========================================
        // TAB 4: LIVE TERMINAL / LOGS
        // ==========================================
        private void BuildLogsTab()
        {
            tabLogs.BackColor = Color.FromArgb(15, 23, 42);
            tabLogs.Padding = new Padding(15);

            // Log Toolbar
            Panel pnlLogTools = new Panel
            {
                Dock = DockStyle.Top,
                Height = 45,
                BackColor = Color.FromArgb(30, 41, 59),
                Padding = new Padding(10)
            };

            lblTaskStatus = new Label
            {
                Text = "جاهز لتنفيذ المهام",
                ForeColor = Color.FromArgb(148, 163, 184),
                Location = new Point(pnlLogTools.Width - 250, 12),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                AutoSize = true,
                Font = new Font("Segoe UI", 10f, FontStyle.Bold)
            };
            pnlLogTools.Controls.Add(lblTaskStatus);

            progressBar = new ProgressBar
            {
                Location = new Point(pnlLogTools.Width - 450, 12),
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
                Size = new Size(180, 20),
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 0,
                Visible = false
            };
            pnlLogTools.Controls.Add(progressBar);

            btnStopTask = new Button
            {
                Text = "🛑 إيقاف المهمة",
                Size = new Size(110, 30),
                Location = new Point(20, 7),
                BackColor = Color.FromArgb(220, 38, 38),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand,
                Enabled = false
            };
            btnStopTask.FlatAppearance.BorderSize = 0;
            btnStopTask.Click += (s, e) => StopCurrentTask();
            pnlLogTools.Controls.Add(btnStopTask);

            Button btnClear = new Button
            {
                Text = "🧹 مسح السجل",
                Size = new Size(100, 30),
                Location = new Point(140, 7),
                BackColor = Color.FromArgb(71, 85, 105),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f),
                Cursor = Cursors.Hand
            };
            btnClear.FlatAppearance.BorderSize = 0;
            btnClear.Click += (s, e) => rtbConsole.Clear();
            pnlLogTools.Controls.Add(btnClear);

            Button btnCopy = new Button
            {
                Text = "📋 نسخ السجل",
                Size = new Size(100, 30),
                Location = new Point(250, 7),
                BackColor = Color.FromArgb(71, 85, 105),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f),
                Cursor = Cursors.Hand
            };
            btnCopy.FlatAppearance.BorderSize = 0;
            btnCopy.Click += (s, e) =>
            {
                if (!string.IsNullOrEmpty(rtbConsole.Text))
                {
                    Clipboard.SetText(rtbConsole.Text);
                    MessageBox.Show("تم نسخ السجل إلى الحافظة!", "تم النسخ", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            };
            pnlLogTools.Controls.Add(btnCopy);

            tabLogs.Controls.Add(pnlLogTools);

            // Terminal Console
            rtbConsole = new RichTextBox
            {
                Dock = DockStyle.Fill,
                BackColor = Color.FromArgb(2, 6, 23),
                ForeColor = Color.FromArgb(226, 232, 240),
                Font = new Font("Consolas", 10f),
                BorderStyle = BorderStyle.None,
                ReadOnly = true,
                RightToLeft = RightToLeft.No // Keep English/Arabic code outputs natural
            };
            tabLogs.Controls.Add(rtbConsole);
            rtbConsole.BringToFront();

            AppendLog("=== مرحباً بك في رادار عروض وتخفيضات أمازون مصر ===");
            AppendLog("مسار المشروع: " + projectDir);
            AppendLog("مترجم Node.js: " + nodeExe);
            AppendLog("النظام جاهز للتشغيل.\n");
        }

        private void BuildStatusStrip()
        {
            statusStrip = new StatusStrip
            {
                BackColor = Color.FromArgb(241, 245, 249),
                Font = new Font("Segoe UI", 9f)
            };

            statusLabel = new ToolStripStatusLabel
            {
                Text = "الحالة: جاهز",
                Spring = true,
                TextAlign = ContentAlignment.MiddleRight
            };

            statusTimeLabel = new ToolStripStatusLabel
            {
                Text = DateTime.Now.ToString("yyyy-MM-dd HH:mm")
            };

            statusStrip.Items.Add(statusLabel);
            statusStrip.Items.Add(statusTimeLabel);
            this.Controls.Add(statusStrip);
        }

        // ==========================================
        // SETTINGS IO
        // ==========================================
        private void LoadSettings()
        {
            if (!File.Exists(configPath)) return;

            try
            {
                string json = File.ReadAllText(configPath, Encoding.UTF8);
                var js = new JavaScriptSerializer();
                var data = js.Deserialize<Dictionary<string, object>>(json);

                if (data != null)
                {
                    if (data.ContainsKey("affiliate"))
                    {
                        var aff = data["affiliate"] as Dictionary<string, object>;
                        if (aff != null && aff.ContainsKey("amazon_tag"))
                            txtAffiliateTag.Text = aff["amazon_tag"].ToString();
                    }

                    if (data.ContainsKey("telegram"))
                    {
                        var tg = data["telegram"] as Dictionary<string, object>;
                        if (tg != null)
                        {
                            if (tg.ContainsKey("bot_token")) txtBotToken.Text = tg["bot_token"].ToString();
                            if (tg.ContainsKey("channel_id")) txtChannelId.Text = tg["channel_id"].ToString();
                            if (tg.ContainsKey("channel_name")) txtChannelName.Text = tg["channel_name"].ToString();
                            if (tg.ContainsKey("posts_per_slot")) numPostsPerSlot.Value = Convert.ToDecimal(tg["posts_per_slot"]);
                            if (tg.ContainsKey("include_hub_links")) chkHubLinks.Checked = Convert.ToBoolean(tg["include_hub_links"]);
                            if (tg.ContainsKey("include_trust_notes")) chkTrustNotes.Checked = Convert.ToBoolean(tg["include_trust_notes"]);
                            if (tg.ContainsKey("use_screenshot_cards")) chkScreenshotCards.Checked = Convert.ToBoolean(tg["use_screenshot_cards"]);
                        }
                    }

                    if (data.ContainsKey("deals_filter"))
                    {
                        var df = data["deals_filter"] as Dictionary<string, object>;
                        if (df != null)
                        {
                            if (df.ContainsKey("min_discount_pct")) numMinDiscount.Value = Convert.ToDecimal(df["min_discount_pct"]);
                            if (df.ContainsKey("max_posts_per_category")) numMaxPerCategory.Value = Convert.ToDecimal(df["max_posts_per_category"]);
                        }
                    }

                    if (lblMinDiscountVal != null) lblMinDiscountVal.Text = numMinDiscount.Value + "%";
                    if (lblPostsPerSlotVal != null) lblPostsPerSlotVal.Text = numPostsPerSlot.Value.ToString();
                    lblSettingsStatus.Text = "تم التحميل بنجاح";
                }
            }
            catch (Exception ex)
            {
                lblSettingsStatus.Text = "خطأ في قراءة config.json: " + ex.Message;
                lblSettingsStatus.ForeColor = Color.Red;
            }
        }

        private void SaveSettings()
        {
            try
            {
                string json = File.ReadAllText(configPath, Encoding.UTF8);
                var js = new JavaScriptSerializer();
                var data = js.Deserialize<Dictionary<string, object>>(json);
                if (data == null) data = new Dictionary<string, object>();

                // Affiliate
                Dictionary<string, object> aff = data.ContainsKey("affiliate") ? data["affiliate"] as Dictionary<string, object> : new Dictionary<string, object>();
                if (aff == null) aff = new Dictionary<string, object>();
                aff["amazon_tag"] = txtAffiliateTag.Text.Trim();
                data["affiliate"] = aff;

                // Telegram
                Dictionary<string, object> tg = data.ContainsKey("telegram") ? data["telegram"] as Dictionary<string, object> : new Dictionary<string, object>();
                if (tg == null) tg = new Dictionary<string, object>();
                tg["bot_token"] = txtBotToken.Text.Trim();
                tg["channel_id"] = txtChannelId.Text.Trim();
                tg["channel_name"] = txtChannelName.Text.Trim();
                tg["posts_per_slot"] = (int)numPostsPerSlot.Value;
                tg["include_hub_links"] = chkHubLinks.Checked;
                tg["include_trust_notes"] = chkTrustNotes.Checked;
                tg["use_screenshot_cards"] = chkScreenshotCards.Checked;
                data["telegram"] = tg;

                // Deals filter
                Dictionary<string, object> df = data.ContainsKey("deals_filter") ? data["deals_filter"] as Dictionary<string, object> : new Dictionary<string, object>();
                if (df == null) df = new Dictionary<string, object>();
                df["min_discount_pct"] = (int)numMinDiscount.Value;
                df["max_posts_per_category"] = (int)numMaxPerCategory.Value;
                data["deals_filter"] = df;

                string updatedJson = js.Serialize(data);
                // Pretty print
                updatedJson = FormatJson(updatedJson);
                File.WriteAllText(configPath, updatedJson, Encoding.UTF8);

                lblSettingsStatus.Text = "✅ تم حفظ التغييرات في config.json بنجاح!";
                lblSettingsStatus.ForeColor = Color.FromArgb(16, 185, 129);

                lblMinDiscountVal.Text = numMinDiscount.Value + "%";
                lblPostsPerSlotVal.Text = numPostsPerSlot.Value.ToString();
                AppendLog("[Config] تم تحديث وحفظ إعدادات config.json بنجاح.");
            }
            catch (Exception ex)
            {
                lblSettingsStatus.Text = "خطأ في حفظ الإعدادات: " + ex.Message;
                lblSettingsStatus.ForeColor = Color.Red;
            }
        }

        private string FormatJson(string json)
        {
            var sb = new StringBuilder();
            bool inQuotes = false;
            int indent = 0;

            for (int i = 0; i < json.Length; i++)
            {
                char ch = json[i];
                if (ch == '\"') inQuotes = !inQuotes;

                if (!inQuotes)
                {
                    if (ch == '{' || ch == '[')
                    {
                        sb.Append(ch);
                        sb.AppendLine();
                        indent += 2;
                        sb.Append(new string(' ', indent));
                    }
                    else if (ch == '}' || ch == ']')
                    {
                        sb.AppendLine();
                        indent -= 2;
                        sb.Append(new string(' ', indent));
                        sb.Append(ch);
                    }
                    else if (ch == ',')
                    {
                        sb.Append(ch);
                        sb.AppendLine();
                        sb.Append(new string(' ', indent));
                    }
                    else if (ch == ':')
                    {
                        sb.Append(": ");
                    }
                    else if (!char.IsWhiteSpace(ch))
                    {
                        sb.Append(ch);
                    }
                }
                else
                {
                    sb.Append(ch);
                }
            }
            return sb.ToString();
        }

        // ==========================================
        // DATA LOADING & DEALS TABLE
        // ==========================================
        private void LoadProductsData()
        {
            allProductsList.Clear();
            if (!File.Exists(productsJsonPath)) return;

            try
            {
                string json = File.ReadAllText(productsJsonPath, Encoding.UTF8);
                var js = new JavaScriptSerializer();
                js.MaxJsonLength = int.MaxValue;
                var list = js.Deserialize<ArrayList>(json);

                if (list != null)
                {
                    foreach (var item in list)
                    {
                        var dict = item as Dictionary<string, object>;
                        if (dict != null)
                        {
                            allProductsList.Add(dict);
                        }
                    }
                }

                FilterDealsGrid();
            }
            catch (Exception ex)
            {
                AppendLog("[-] خطأ في تحميل products.json: " + ex.Message);
            }
        }

        private void FilterDealsGrid()
        {
            if (dgvDeals == null) return;

            dgvDeals.Rows.Clear();
            string keyword = txtSearchDeals != null ? txtSearchDeals.Text.Trim().ToLower() : "";
            int filterMode = cmbDealFilter != null ? cmbDealFilter.SelectedIndex : 0;

            int count = 0;
            foreach (var p in allProductsList)
            {
                string title = p.ContainsKey("title") && p["title"] != null ? p["title"].ToString() : "";
                string brand = p.ContainsKey("brand") && p["brand"] != null ? p["brand"].ToString() : "";
                string cat = p.ContainsKey("category") && p["category"] != null ? p["category"].ToString() : "";
                string asin = p.ContainsKey("asin") && p["asin"] != null ? p["asin"].ToString() : "";

                // Search check
                if (!string.IsNullOrEmpty(keyword))
                {
                    bool match = title.ToLower().Contains(keyword) || brand.ToLower().Contains(keyword) || cat.ToLower().Contains(keyword) || asin.ToLower().Contains(keyword);
                    if (!match) continue;
                }

                // Filter mode
                double discPct = 0;
                if (p.ContainsKey("historical_discount_pct") && p["historical_discount_pct"] != null)
                    double.TryParse(p["historical_discount_pct"].ToString(), out discPct);
                else if (p.ContainsKey("advertised_discount_pct") && p["advertised_discount_pct"] != null)
                    double.TryParse(p["advertised_discount_pct"].ToString(), out discPct);

                bool isRealDeal = p.ContainsKey("is_real_deal") && Convert.ToBoolean(p["is_real_deal"]);
                bool isAllTimeLow = p.ContainsKey("all_time_low") && Convert.ToBoolean(p["all_time_low"]);

                if (filterMode == 1 && discPct <= 0 && !isRealDeal) continue; // Deals only
                if (filterMode == 2 && !isAllTimeLow) continue; // All-time low only

                string currPrice = p.ContainsKey("currentPriceNum") && p["currentPriceNum"] != null ? p["currentPriceNum"].ToString() + " ج.م" : "";
                string oldPrice = p.ContainsKey("oldPriceNum") && p["oldPriceNum"] != null ? p["oldPriceNum"].ToString() + " ج.م" : "—";
                string savings = p.ContainsKey("egpSaved") && p["egpSaved"] != null ? p["egpSaved"].ToString() + " ج.م" : "—";
                string discStr = discPct > 0 ? (discPct + "%") : "—";

                int rowIndex = dgvDeals.Rows.Add(asin, title, brand, cat, currPrice, oldPrice, discStr, savings);
                if (discPct >= 20 || isRealDeal)
                {
                    dgvDeals.Rows[rowIndex].Cells["discount"].Style.ForeColor = Color.FromArgb(220, 38, 38);
                    dgvDeals.Rows[rowIndex].Cells["discount"].Style.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
                }

                count++;
            }

            if (lblDealsCount != null) lblDealsCount.Text = "العدد المعروض: " + count + " منتج";
        }

        private void UpdateDashboardStats()
        {
            if (lblTotalProductsVal != null) lblTotalProductsVal.Text = allProductsList.Count.ToString();

            if (File.Exists(dealsReportJsonPath))
            {
                try
                {
                    string json = File.ReadAllText(dealsReportJsonPath, Encoding.UTF8);
                    var js = new JavaScriptSerializer();
                    var report = js.Deserialize<Dictionary<string, object>>(json);
                    if (report != null)
                    {
                        if (report.ContainsKey("totalDealsCount") && lblTotalDealsVal != null)
                            lblTotalDealsVal.Text = report["totalDealsCount"].ToString();
                        if (report.ContainsKey("newPriceDropsCount") && lblPriceDropsVal != null)
                            lblPriceDropsVal.Text = report["newPriceDropsCount"].ToString();
                    }
                }
                catch { }
            }
        }

        // ==========================================
        // PROCESS RUNNER (ASYNC STREAMING)
        // ==========================================
        private void RunNodeScript(string scriptRelativePath, string taskName, string extraArgs = "")
        {
            if (currentProcess != null && !currentProcess.HasExited)
            {
                MessageBox.Show("توجد عملية أخرى قيد التشغيل حالياً! يرجى الانتظار أو إيقافها أولاً.", "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string fullScriptPath = Path.Combine(projectDir, scriptRelativePath);
            if (!File.Exists(fullScriptPath))
            {
                MessageBox.Show("لم يتم العثور على الملف:\n" + fullScriptPath, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // Switch to Logs Tab
            mainTabs.SelectedTab = tabLogs;
            AppendLog(string.Format("\n======================================================="));
            AppendLog(string.Format("[*] بدء تنفيذ: {0} ({1})", taskName, DateTime.Now.ToString("HH:mm:ss")));
            AppendLog(string.Format("======================================================="));

            lblTaskStatus.Text = "جاري تنفيذ: " + taskName;
            lblTaskStatus.ForeColor = Color.FromArgb(217, 119, 6); // Amber
            progressBar.Visible = true;
            progressBar.MarqueeAnimationSpeed = 30;
            btnStopTask.Enabled = true;
            statusLabel.Text = "الحالة: جاري تنفيذ " + taskName + "...";

            string args = string.Format("\"{0}\" {1}", fullScriptPath, extraArgs).Trim();

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = args,
                WorkingDirectory = projectDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            try
            {
                currentProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };

                currentProcess.OutputDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        this.BeginInvoke((Action)(() => AppendLog(e.Data)));
                    }
                };

                currentProcess.ErrorDataReceived += (s, e) =>
                {
                    if (e.Data != null)
                    {
                        this.BeginInvoke((Action)(() => AppendLog("[-] " + e.Data)));
                    }
                };

                currentProcess.Exited += (s, e) =>
                {
                    this.BeginInvoke((Action)(() =>
                    {
                        int exitCode = currentProcess.ExitCode;
                        progressBar.Visible = false;
                        progressBar.MarqueeAnimationSpeed = 0;
                        btnStopTask.Enabled = false;

                        if (exitCode == 0)
                        {
                            lblTaskStatus.Text = "اكتملت العملية بنجاح! (" + taskName + ")";
                            lblTaskStatus.ForeColor = Color.FromArgb(16, 185, 129);
                            statusLabel.Text = "الحالة: جاهز (آخر مهمة نجحت)";
                            AppendLog(string.Format("\n[✔] اكتملت المهمة ({0}) بنجاح في {1}", taskName, DateTime.Now.ToString("HH:mm:ss")));
                        }
                        else
                        {
                            lblTaskStatus.Text = "انتهت العملية بكود خطأ: " + exitCode;
                            lblTaskStatus.ForeColor = Color.FromArgb(220, 38, 38);
                            statusLabel.Text = "الحالة: فشلت المهمة!";
                            AppendLog(string.Format("\n[!] توقفت المهمة بكود: {0}", exitCode));
                        }

                        // Auto-refresh stats and deals after tasks like tracker or scraper
                        LoadProductsData();
                        UpdateDashboardStats();
                    }));
                };

                currentProcess.Start();
                currentProcess.BeginOutputReadLine();
                currentProcess.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLog("[-] خطأ في تشغيل Node: " + ex.Message);
                lblTaskStatus.Text = "خطأ في بدء المهمة!";
                progressBar.Visible = false;
                btnStopTask.Enabled = false;
            }
        }

        private void StopCurrentTask()
        {
            if (currentProcess != null && !currentProcess.HasExited)
            {
                try
                {
                    currentProcess.Kill();
                    AppendLog("\n[!] تم إيقاف المهمة يدوياً بواسطة المستخدم.");
                    lblTaskStatus.Text = "تم إيقاف المهمة يدوياً";
                    lblTaskStatus.ForeColor = Color.FromArgb(220, 38, 38);
                    progressBar.Visible = false;
                    btnStopTask.Enabled = false;
                    statusLabel.Text = "الحالة: جاهز (تم الإيقاف)";
                }
                catch (Exception ex)
                {
                    AppendLog("[-] تعذر إيقاف العملية: " + ex.Message);
                }
            }
        }

        private void AppendLog(string text)
        {
            if (rtbConsole.IsDisposed) return;

            rtbConsole.AppendText(text + "\n");
            rtbConsole.SelectionStart = rtbConsole.Text.Length;
            rtbConsole.ScrollToCaret();
        }

        private void OpenDealsWebPage()
        {
            string htmlPath = Path.Combine(projectDir, "dist", "index.html");
            if (!File.Exists(htmlPath))
            {
                htmlPath = Path.Combine(projectDir, "index.html");
            }

            if (File.Exists(htmlPath))
            {
                try { Process.Start(new ProcessStartInfo(htmlPath) { UseShellExecute = true }); }
                catch (Exception ex) { MessageBox.Show("تعذر فتح صفحة العروض: " + ex.Message); }
            }
            else
            {
                MessageBox.Show("لم يتم بناء صفحة العروض بعد! يرجى الضغط على زر 'بناء موقع العروض والبراندات' أولاً.", "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }
}

use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, Paragraph},
    Terminal,
};
use std::io::{self, stdout};

pub struct TuiManager {
    terminal: Terminal<CrosstermBackend<std::io::Stdout>>,
}

impl TuiManager {
    pub fn new() -> io::Result<Self> {
        let backend = CrosstermBackend::new(stdout());
        let terminal = Terminal::new(backend)?;
        Ok(Self { terminal })
    }

    pub fn draw_layout(
        &mut self,
        active_content: &str,
        system_logs: &str,
        status_line: &str,
    ) -> io::Result<()> {
        self.terminal.draw(|f| {
            let area = f.area();
            if area.width < 80 || area.height < 24 {
                let fallback = Paragraph::new("Terminal too small.
Resize to at least 80x24.")
                    .style(Style::default().fg(Color::Red).add_modifier(Modifier::BOLD));
                f.render_widget(fallback, area);
                return;
            }

            // Base Layout: Main split (content above, status bar below)
            let main_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(3), Constraint::Length(1)])
                .split(area);

            // Top Panel Split (Main content vs System Logs)
            let top_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
                .split(main_chunks[0]);

            // AXiM Modern-Retro Style Definition

            let active_border = Style::default().fg(Color::Cyan); // Modern Cyan
            let success_text = Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD);

            // Main Chat/Workspace Block
            let main_block = Block::default()
                .title(" Onyx Intelligence ")
                .borders(Borders::ALL)
                .border_style(active_border);
            let main_paragraph = Paragraph::new(active_content).block(main_block);
            f.render_widget(main_paragraph, top_chunks[0]);

            // Side Panel / System Logs
            let side_block = Block::default()
                .title(" System Telemetry ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(100, 100, 150)));
            let side_paragraph = Paragraph::new(system_logs)
                .block(side_block)
                .style(success_text);
            f.render_widget(side_paragraph, top_chunks[1]);

            // Status Bar
            let status_paragraph = Paragraph::new(status_line)
                .style(Style::default().bg(Color::Rgb(30, 30, 30)).fg(Color::Cyan));
            f.render_widget(status_paragraph, main_chunks[1]);
        })?;
        Ok(())
    }
}

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
            // Base Layout: Main split (content above, status bar below)
            let main_chunks = Layout::default()
                .direction(Direction::Vertical)
                .constraints([Constraint::Min(3), Constraint::Length(1)])
                .split(f.area());

            // Top Panel Split (Main content vs System Logs)
            let top_chunks = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
                .split(main_chunks[0]);

            // AXiM Modern-Retro Style Definition

            let active_border = Style::default().fg(Color::Cyan); // Modern Cyan
            let success_text = Style::default()
                .fg(Color::LightGreen)
                .add_modifier(Modifier::BOLD);

            // Main Chat/Workspace Block
            let main_block = Block::default()
                .title(" AXiM Workspace ")
                .borders(Borders::ALL)
                .border_style(active_border);
            let main_paragraph = Paragraph::new(active_content).block(main_block);
            f.render_widget(main_paragraph, top_chunks[0]);

            // Side Panel / System Logs
            let side_block = Block::default()
                .title(" Onyx Telemetry ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue));
            let side_paragraph = Paragraph::new(system_logs)
                .block(side_block)
                .style(success_text);
            f.render_widget(side_paragraph, top_chunks[1]);

            // Status Bar
            let status_paragraph = Paragraph::new(status_line)
                // Use CRT Amber for warnings but standard here for now. Status bar takes care of its own colors usually but here we just render it.
                .style(Style::default().bg(Color::Reset).fg(Color::White));
            f.render_widget(status_paragraph, main_chunks[1]);
        })?;
        Ok(())
    }
}

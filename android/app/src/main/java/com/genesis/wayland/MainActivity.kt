package com.genesis.wayland

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genesis.wayland.data.ChatMessage
import com.genesis.wayland.data.Conversation
import com.genesis.wayland.ui.AppViewModel

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent { MaterialTheme { App() } }
  }
}

@Composable
private fun App(vm: AppViewModel = viewModel()) {
  Scaffold { pad ->
    Column(Modifier.padding(pad).padding(12.dp).fillMaxSize()) {
      when (val screen = vm.screen) {
        is AppViewModel.Screen.Connect -> ConnectScreen(vm)
        is AppViewModel.Screen.Conversations -> ConversationsScreen(vm)
        is AppViewModel.Screen.Chat -> ChatScreen(vm, screen.conversation)
      }
    }
  }
}

@Composable
private fun ConnectScreen(vm: AppViewModel) {
  var url by remember { mutableStateOf(vm.lastUrl) }
  var user by remember { mutableStateOf(vm.lastUser) }
  var pass by remember { mutableStateOf("") }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text("Connect to your Wayland server", style = MaterialTheme.typography.titleLarge)
    OutlinedTextField(url, { url = it }, label = { Text("Server URL (http://host:3000)") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(user, { user = it }, label = { Text("Username") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
      pass, { pass = it }, label = { Text("Password") },
      visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
    )
    Button(onClick = { vm.connect(url, user, pass) }, enabled = !vm.busy) { Text("Connect") }
    if (vm.busy) CircularProgressIndicator()
    vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    if (vm.hasCache) {
      Button(onClick = { vm.browseOffline() }) { Text("Browse offline (last sync)") }
    }
  }
}

@Composable
private fun ConversationsScreen(vm: AppViewModel) {
  Column {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Text("Conversations", style = MaterialTheme.typography.titleLarge)
      Text(if (vm.online) "online" else "offline cache", style = MaterialTheme.typography.labelMedium)
    }
    vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      items(vm.conversations, key = { it.id }) { c: Conversation ->
        Card(onClick = { vm.openConversation(c) }) {
          Text(c.name, Modifier.padding(12.dp).fillMaxWidth())
        }
      }
    }
  }
}

@Composable
private fun ChatScreen(vm: AppViewModel, conversation: Conversation) {
  var input by remember { mutableStateOf("") }
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
      Button(onClick = { vm.backToList() }) { Text("Back") }
      Text(conversation.name, style = MaterialTheme.typography.titleMedium)
    }
    vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      items(vm.messages, key = { it.id }) { m: ChatMessage ->
        val who = if (m.role == "right" || m.role == "user") "You" else "Agent"
        Card { Text("$who: ${m.text}", Modifier.padding(10.dp).fillMaxWidth()) }
      }
    }
    if (vm.online) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(input, { input = it }, modifier = Modifier.weight(1f), label = { Text("Message") })
        Button(
          onClick = { vm.send(conversation, input); input = "" },
          enabled = input.isNotBlank() && !vm.busy
        ) { Text("Send") }
      }
    } else {
      Text("Offline - read-only cache. Connect to send.", style = MaterialTheme.typography.labelMedium)
    }
  }
}
